# RLoop Task Monitor

## Purpose
Step-based task tracking for long-running agent tasks. Before execution, the agent registers a detailed step plan. As each step completes, the agent updates the status. The plugin detects stalls and can resume interrupted tasks.

## When to Use
- Tasks with multiple distinct steps
- Long-running operations (>5 minutes)
- Batch processing with clear stages
- Multi-step debugging workflows

## Core Concept
**STATE.json is the task blueprint.** It contains all steps upfront with their statuses. The task is done when ALL steps are `completed`.

---

## Tool Usage

### 1. Register Task (at start)
```
Tool: rloop_register_task
{
  "taskName": "从知乎读20篇AI相关文章",
  "steps": [
    { "desc": "搜索知乎 AI 文章 第1批(5篇)" },
    { "desc": "搜索知乎 AI 文章 第2批(5篇)" },
    { "desc": "搜索知乎 AI 文章 第3批(5篇)" },
    { "desc": "搜索知乎 AI 文章 第4批(5篇)" },
    { "desc": "汇总报告" }
  ],
  "stallTimeoutMs": 300000
}
```
Returns: `{ taskId: "uuid", steps: [...], status: "running" }`

**Important:** Step 1 is automatically set to `running`. All others are `pending`.

---

### 2. Update Step (after each step)
```
Tool: rloop_update_step
{
  "taskId": "uuid",
  "stepId": 1,
  "status": "completed"
}
```
Then set next step to running:
```
Tool: rloop_update_step
{
  "taskId": "uuid",
  "stepId": 2,
  "status": "running"
}
```

---

### 3. Send Heartbeat (during long steps)
```
Tool: rloop_heartbeat
{
  "taskId": "uuid"
}
```
Prevents false stall detection during a long-running step.

---

### 4. Get Task Status
```
Tool: rloop_get_task
{
  "taskId": "uuid"
}
```
Returns full task state including all steps.

---

### 5. Complete Task
```
Tool: rloop_complete_task
{
  "taskId": "uuid"
}
```
Marks all remaining steps as completed and task as `completed`.

---

### 6. Fail Task
```
Tool: rloop_fail_task
{
  "taskId": "uuid",
  "error": "错误原因"
}
```

---

### 7. List Tasks
```
Tool: rloop_list_tasks
{
  "status": "running"
}
```

---

## Workflow Example

```
1. [Start] → rloop_register_task(taskName="读20篇知乎文章", steps=[5步])
   ← Returns: { taskId: "abc-123", step 1 = running }

2. [Step 1] → tavily_search + 阅读5篇
   → rloop_update_step(taskId="abc-123", stepId=1, status="completed")
   → rloop_update_step(taskId="abc-123", stepId=2, status="running")

3. [Step 2] → tavily_search + 阅读5篇
   → rloop_update_step(taskId="abc-123", stepId=2, status="completed")
   → rloop_update_step(taskId="abc-123", stepId=3, status="running")

4. [Long step] → 每分钟 heartbeat 防止误判
   → rloop_heartbeat(taskId="abc-123")

5. [All done] → rloop_complete_task(taskId="abc-123")
```

---

## Stall Detection

- If no heartbeat for `stallTimeoutMs` (default 5 min), task is marked `stalled`
- When `before_agent_start` hook runs, stalled tasks are logged
- Agent should call `rloop_get_task` to check for stalled tasks and continue

---

## STATE.json Structure

```json
{
  "taskName": "从知乎读20篇AI相关文章",
  "status": "running",
  "steps": [
    { "id": 1, "desc": "搜索第1批", "status": "completed", "updatedAt": "..." },
    { "id": 2, "desc": "搜索第2批", "status": "running", "updatedAt": "..." },
    { "id": 3, "desc": "搜索第3批", "status": "pending", "updatedAt": null }
  ],
  "progress": { "currentStep": 2, "totalSteps": 5, "completedSteps": 1 },
  "stallDetection": { "enabled": true, "stallTimeoutMs": 300000, "lastHeartbeat": "..." }
}
```

---

## Notes
- All steps should be registered upfront - plan the task fully before starting
- Call heartbeat during long operations (e.g., reading many articles)
- Task is complete when ALL steps are `completed` OR you call `rloop_complete_task`
- Stalled tasks resume from where they stopped (check step status)
