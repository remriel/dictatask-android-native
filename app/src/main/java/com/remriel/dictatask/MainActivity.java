package com.remriel.dictatask;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;

import com.google.android.material.snackbar.Snackbar;
import com.remriel.dictatask.databinding.ActivityMainBinding;

import java.util.ArrayList;
import java.util.List;

public final class MainActivity extends AppCompatActivity {
    private ActivityMainBinding binding;
    private TaskStore taskStore;
    private TaskAdapter taskAdapter;
    private SpeechRecognizer speechRecognizer;
    private ActivityResultLauncher<String> microphonePermissionLauncher;
    private List<Task> tasks = new ArrayList<>();
    private boolean isListening;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        taskStore = new TaskStore(this);
        tasks = taskStore.load();
        configureTaskList();
        configurePermissionRequest();
        configureSpeechRecognition();
        configureActions();
        renderTasks();
        updateVoiceState(getString(R.string.voice_status_ready));
    }

    private void configureTaskList() {
        taskAdapter = new TaskAdapter(new TaskAdapter.Listener() {
            @Override
            public void onCompletionChanged(Task task, boolean completed) {
                task.setCompleted(completed);
                persistAndRender();
            }

            @Override
            public void onRemoveRequested(Task task) {
                tasks.remove(task);
                persistAndRender();
                Snackbar.make(binding.getRoot(), R.string.task_removed, Snackbar.LENGTH_SHORT).show();
            }
        });

        binding.taskList.setLayoutManager(new LinearLayoutManager(this));
        binding.taskList.setAdapter(taskAdapter);
        binding.taskList.setNestedScrollingEnabled(false);
    }

    private void configurePermissionRequest() {
        microphonePermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> {
                    if (granted) {
                        startListening();
                    } else {
                        updateVoiceState(getString(R.string.voice_status_permission_denied));
                        Snackbar.make(
                                binding.getRoot(),
                                R.string.microphone_permission_needed,
                                Snackbar.LENGTH_LONG
                        ).show();
                    }
                }
        );
    }

    private void configureSpeechRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            binding.dictateButton.setEnabled(false);
            updateVoiceState(getString(R.string.voice_status_unavailable));
            return;
        }

        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        speechRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                isListening = true;
                updateVoiceState(getString(R.string.voice_status_listening));
                updateDictationButton();
            }

            @Override
            public void onBeginningOfSpeech() {
                updateVoiceState(getString(R.string.voice_status_hearing));
            }

            @Override
            public void onRmsChanged(float rmsdB) {
                // The status text carries the listening feedback without visual noise.
            }

            @Override
            public void onBufferReceived(byte[] buffer) {
                // No raw audio is retained by this app.
            }

            @Override
            public void onEndOfSpeech() {
                isListening = false;
                updateVoiceState(getString(R.string.voice_status_finishing));
                updateDictationButton();
            }

            @Override
            public void onError(int error) {
                isListening = false;
                updateVoiceState(speechErrorMessage(error));
                updateDictationButton();
            }

            @Override
            public void onResults(Bundle results) {
                applySpeechResults(results, false);
                isListening = false;
                updateVoiceState(getString(R.string.voice_status_captured));
                updateDictationButton();
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                applySpeechResults(partialResults, true);
            }

            @Override
            public void onEvent(int eventType, Bundle params) {
                // No additional event handling is needed for one-shot dictation.
            }
        });
    }

    private void configureActions() {
        binding.dictateButton.setOnClickListener(view -> toggleDictation());
        binding.saveTaskButton.setOnClickListener(view -> saveDraft());
        binding.clearDraftButton.setOnClickListener(view -> {
            binding.transcriptInput.setText("");
            updateVoiceState(getString(R.string.voice_status_ready));
        });
    }

    private void toggleDictation() {
        if (isListening) {
            if (speechRecognizer != null) {
                speechRecognizer.stopListening();
            }
            return;
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            startListening();
        } else {
            microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO);
        }
    }

    private void startListening() {
        if (speechRecognizer == null) {
            updateVoiceState(getString(R.string.voice_status_unavailable));
            return;
        }

        Intent recognitionIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        recognitionIntent.putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        recognitionIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        recognitionIntent.putExtra(
                RecognizerIntent.EXTRA_PROMPT,
                getString(R.string.dictation_prompt)
        );

        try {
            speechRecognizer.startListening(recognitionIntent);
        } catch (SecurityException exception) {
            updateVoiceState(getString(R.string.voice_status_permission_denied));
        }
    }

    private void applySpeechResults(Bundle results, boolean partial) {
        if (results == null) {
            return;
        }

        ArrayList<String> candidates = results.getStringArrayList(
                SpeechRecognizer.RESULTS_RECOGNITION
        );
        if (candidates == null || candidates.isEmpty()) {
            return;
        }

        String transcript = candidates.get(0).trim();
        if (transcript.isEmpty()) {
            return;
        }

        binding.transcriptInput.setText(transcript);
        binding.transcriptInput.setSelection(transcript.length());
        if (partial) {
            updateVoiceState(getString(R.string.voice_status_hearing));
        }
    }

    private void saveDraft() {
        String title = binding.transcriptInput.getText() == null
                ? ""
                : binding.transcriptInput.getText().toString().trim();

        if (title.isEmpty()) {
            binding.transcriptLayout.setError(getString(R.string.task_required));
            binding.transcriptInput.requestFocus();
            return;
        }

        binding.transcriptLayout.setError(null);
        long timestamp = System.currentTimeMillis();
        tasks.add(0, new Task(timestamp, title, timestamp, false));
        binding.transcriptInput.setText("");
        persistAndRender();
        updateVoiceState(getString(R.string.voice_status_saved));
        Snackbar.make(binding.getRoot(), R.string.task_saved, Snackbar.LENGTH_SHORT).show();
    }

    private void persistAndRender() {
        taskStore.save(tasks);
        renderTasks();
    }

    private void renderTasks() {
        taskAdapter.submit(tasks);
        int completedCount = 0;
        for (Task task : tasks) {
            if (task.isCompleted()) {
                completedCount++;
            }
        }

        int openCount = tasks.size() - completedCount;
        binding.taskSummary.setText(getString(R.string.task_summary, openCount, completedCount));
        boolean isEmpty = tasks.isEmpty();
        binding.emptyState.setVisibility(isEmpty ? View.VISIBLE : View.GONE);
        binding.taskList.setVisibility(isEmpty ? View.GONE : View.VISIBLE);
    }

    private void updateVoiceState(String message) {
        binding.voiceStatus.setText(message);
    }

    private void updateDictationButton() {
        boolean listening = isListening;
        binding.dictateButton.setText(
                listening ? R.string.stop_dictation : R.string.start_dictation
        );
        int color = ContextCompat.getColor(
                this,
                listening ? R.color.dt_magenta : R.color.dt_lime
        );
        binding.dictateButton.setBackgroundTintList(ColorStateList.valueOf(color));
    }

    @NonNull
    private String speechErrorMessage(int errorCode) {
        switch (errorCode) {
            case SpeechRecognizer.ERROR_AUDIO:
                return getString(R.string.voice_status_audio_error);
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return getString(R.string.voice_status_no_match);
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return getString(R.string.voice_status_permission_denied);
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return getString(R.string.voice_status_network_error);
            default:
                return getString(R.string.voice_status_try_again);
        }
    }

    @Override
    protected void onDestroy() {
        if (speechRecognizer != null) {
            speechRecognizer.cancel();
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        super.onDestroy();
    }
}

