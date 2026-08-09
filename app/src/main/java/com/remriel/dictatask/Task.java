package com.remriel.dictatask;

public final class Task {
    private final long id;
    private final String title;
    private final long createdAt;
    private boolean completed;

    public Task(long id, String title, long createdAt, boolean completed) {
        this.id = id;
        this.title = title;
        this.createdAt = createdAt;
        this.completed = completed;
    }

    public long getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public long getCreatedAt() {
        return createdAt;
    }

    public boolean isCompleted() {
        return completed;
    }

    public void setCompleted(boolean completed) {
        this.completed = completed;
    }
}

