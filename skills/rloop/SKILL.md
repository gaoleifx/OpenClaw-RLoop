---
name: rloop
description: RLoop 任务监控技能 - 用于追踪长时间运行的多步骤任务，提供进度更新、stall检测和断点恢复。
---

# RLoop Task Monitor

## 核心理念

**STATE.json 是任务的"宪法"。** 每个任务在动手之前先讨论清楚细节，把完整计划写入 STATE.json，后续所有执行完全依准文件，不再重复讨论。

---

## 标准化工作流

```
用户发起任务
    ↓
① 头脑风暴（讨论阶段）
    ↓
② 生成 STATE.json（计划阶段）
    ↓
③ 确认计划
    ↓
④ RLoop 注册 + 执行（执行阶段）
    ↓
⑤ 完成
```

---

## 阶段详解

### ① 头脑风暴（讨论）

接到任务后，先不急着动手，和用户讨论清楚：

- **目标**：要达成什么结果？
- **范围**：具体包含哪些内容？
- **怎么做**：分哪几步？每步用什么方法？
- **边界情况**：遇到错误怎么办？哪些可以跳过？
- **完成标准**：怎么判断任务真正完成？
- **断点恢复**：如果中途断了，从哪继续？

### ② 生成 STATE.json

讨论完后，把完整计划写成 `STATE.json`：

```json
{
  "taskName": "任务名称",
  "createdAt": "ISO时间",
  "brainstorm": {
    "goal": "目标描述",
    "scope": "范围描述",
    "breakdown": {
      "method": "整体方法",
      "fallback_on_error": "错误处理策略",
      "resume_point": "断点恢复方式",
      "done_criteria": "完成判断标准"
    }
  },
  "execution": {
    "status": "planned",
    "currentStep": 0,
    "totalSteps": N,
    "completedSteps": 0,
    "steps": [
      { "id": 1, "desc": "步骤描述", "method": "执行方法", "status": "pending" }
    ]
  }
}
```

**发给用户确认**，用户认可后再往下走。

### ③ 确认计划

用户确认 STATE.json 后，开始执行。

### ④ 执行

**注册 RLoop 任务**：
```
rloop_register_task
{
  "taskName": "<按STATE.json>",
  "steps": [<按STATE.json的steps>],
  "stallTimeoutMs": <按需，默认300000>
}
```

**执行每一步**：
- 按 STATE.json 的顺序和方法执行
- 每步完成后更新 `rloop_update_step`
- 长任务定期 `rloop_heartbeat`
- 同时更新本地 STATE.json（step status 变化）

**断点恢复**：
- 先读现有的 STATE.json
- 检查已完成步骤，确认断点位置
- 不重新讨论，直接从断点继续
- 如有重大变更（比如外部依赖变化），才重新头脑风暴

### ⑤ 完成

- 所有步骤 completed → `rloop_complete_task`
- 更新 STATE.json status = "completed"
- 输出总结报告

---

## 工具使用

### 注册任务
```
rloop_register_task
{
  "taskName": "任务名",
  "steps": [
    { "desc": "步骤1描述" },
    { "desc": "步骤2描述" }
  ],
  "stallTimeoutMs": 300000
}
```

### 更新步骤
```
rloop_update_step
{ "taskId": "uuid", "stepId": 1, "status": "completed" }
```

### 发送心跳（长任务每分钟一次）
```
rloop_heartbeat
{ "taskId": "uuid" }
```

### 获取状态
```
rloop_get_task
{ "taskId": "uuid" }
```

### 完成任务
```
rloop_complete_task
{ "taskId": "uuid" }
```

### 标记失败
```
rloop_fail_task
{ "taskId": "uuid", "error": "错误原因" }
```

### 查看所有任务
```
rloop_list_tasks
{ "status": "running" }
```

---

## 状态流转

```
planned → running → completed
                  → stalled (无心跳超时)
                  → failed (明确失败)
stalled → running (恢复执行)
```

---

## 约定

- **不跳步**：没有头脑风暴 = 不能生成 STATE.json = 不能注册执行
- **不返工**：STATE.json 一旦确认，执行阶段严格按文件走，不临时改计划
- **不丢状态**：每步执行完立即更新 STATE.json 和 RLoop，不要等到最后一起更新
- **心跳保活**：单步超过 2 分钟的任务，每分钟发一次 heartbeat
- **断点优先**：遇到 stalled，先读 STATE.json 确认断点，不重新讨论

---

## RLoop 内置的 Stall 检测

- 默认 5 分钟无 heartbeat → 自动标记 stalled
- 收到任务后，agent 会检查 stalled 任务并尝试恢复
- 恢复时只从断点继续，不重新开始

---

## 注意

- SKILL.md 是文档约定，不是代码。STATE.json 格式和流程规范都在这里定义
- 所有任务都走统一流程：讨论 → 计划 → 执行
