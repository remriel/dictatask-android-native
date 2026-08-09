package com.remriel.dictatask;

import android.graphics.Paint;
import android.view.LayoutInflater;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.remriel.dictatask.databinding.ItemTaskBinding;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

public final class TaskAdapter extends RecyclerView.Adapter<TaskAdapter.TaskViewHolder> {
    public interface Listener {
        void onCompletionChanged(Task task, boolean completed);

        void onRemoveRequested(Task task);
    }

    private final List<Task> tasks = new ArrayList<>();
    private final Listener listener;

    public TaskAdapter(Listener listener) {
        this.listener = listener;
    }

    public void submit(List<Task> updatedTasks) {
        tasks.clear();
        tasks.addAll(updatedTasks);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public TaskViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        ItemTaskBinding binding = ItemTaskBinding.inflate(
                LayoutInflater.from(parent.getContext()), parent, false
        );
        return new TaskViewHolder(binding);
    }

    @Override
    public void onBindViewHolder(@NonNull TaskViewHolder holder, int position) {
        Task task = tasks.get(position);
        boolean completed = task.isCompleted();

        holder.binding.taskTitle.setText(task.getTitle());
        holder.binding.taskMeta.setText(
                holder.binding.getRoot().getContext().getString(
                        R.string.task_created,
                        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                                .format(new Date(task.getCreatedAt()))
                )
        );
        holder.binding.taskCheck.setOnCheckedChangeListener(null);
        holder.binding.taskCheck.setChecked(completed);
        holder.binding.taskCheck.setContentDescription(
                holder.binding.getRoot().getContext().getString(
                        completed ? R.string.mark_open : R.string.mark_complete,
                        task.getTitle()
                )
        );
        holder.binding.taskCheck.setOnCheckedChangeListener(
                (buttonView, isChecked) -> listener.onCompletionChanged(task, isChecked)
        );
        holder.binding.removeButton.setOnClickListener(v -> listener.onRemoveRequested(task));
        holder.binding.getRoot().setAlpha(completed ? 0.62f : 1f);

        int currentFlags = holder.binding.taskTitle.getPaintFlags();
        if (completed) {
            holder.binding.taskTitle.setPaintFlags(currentFlags | Paint.STRIKE_THRU_TEXT_FLAG);
        } else {
            holder.binding.taskTitle.setPaintFlags(currentFlags & ~Paint.STRIKE_THRU_TEXT_FLAG);
        }
    }

    @Override
    public int getItemCount() {
        return tasks.size();
    }

    static final class TaskViewHolder extends RecyclerView.ViewHolder {
        private final ItemTaskBinding binding;

        TaskViewHolder(ItemTaskBinding binding) {
            super(binding.getRoot());
            this.binding = binding;
        }
    }
}

