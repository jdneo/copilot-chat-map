# Domain Context

## Conversation Family

以一个 Root Session 为起点，由 Conversation Fork Map 创建并追踪的全部 Session Branch 组成的树。

画布外创建的 fork 不属于该 Conversation Family。

## Root Session

Conversation Family 的最初会话。Root Session 即使被删除，其身份仍保留，用于维持家族血缘。

## Session Branch

Copilot 中一个持久的本地会话。除 Root Session 外，每个 Session Branch 恰好来源于一个父会话中的 Fork Checkpoint。

## CLI-only Session Branch

只能通过 Copilot CLI 继续对话、不会作为 Copilot App Chat 出现的 Session Branch。它在 App 中不可见不代表会话不可用。

## CLI Handoff

Session Branch 创建成功后，用户转到 Copilot CLI 开始该分支首轮对话的交接阶段。

## Turn Node

画布上的基本对话节点，代表由一个可见用户输入开始的一轮交互：

- 一个用户输入。
- 对应的 Copilot 回复；进行中、中断或缺少最终回复时可为空。
- 期间产生的可展开执行详情。

单条用户消息或 Copilot 消息都不是独立图节点。
Turn Node 可以是已完成或未完成状态；只有已完成状态可以成为 Fork Checkpoint。

## Fork Checkpoint

一个已完成 Turn Node 之后的稳定历史边界。新 Session Branch 包含该完整轮次以及之前的历史，不包含之后的轮次。

进行中、中断或缺少最终回复的轮次不是 Fork Checkpoint。

## Fork Operation

用户从一个 Fork Checkpoint 创建子 Session Branch 的单次意图。子会话一旦创建，后续血缘记录或 CLI Handoff 失败都不会使该操作重新创建另一个子会话。

## Lineage Index

扩展持久化的结构化父子关系。它记录会话身份、父会话、Fork Checkpoint 和创建顺序，但不复制消息正文。

## Untracked Child Session

已经创建但未能写入 Lineage Index 的子会话。它仍是有效的本地会话，但不属于 Conversation Family，且不会被自动重新创建。

## Tombstone

会话或来源检查点已经缺失时保留的占位节点。Tombstone 维持真实血缘，不代表仍可读取或分叉。

## Current Session

当前 Chat View 绑定的前台会话。打开 Conversation Fork Map 时，完整 Conversation Family 可见，但 Current Session 会被聚焦和高亮。

## Invariants

- Conversation Family 是一棵树，不允许环。
- 每个 Session Branch 最多属于一个 Conversation Family。
- 每个非根 Session Branch 恰好有一个父会话。
- Fork Checkpoint 只属于一个父会话中的完整 Turn Node。
- 同一 Fork Checkpoint 可以有多个子 Session Branch。
- 只有 Lineage Index 已持久记录的子 Session Branch 才能自动成为 Current Session。
- Fork Operation 在子会话创建前失败时不改变 Lineage Index。
- 子会话创建后，不因血缘记录或 CLI Handoff 失败而隐式创建替代会话。
- 血缘缺失时保留 Tombstone，不自动改挂或猜测关系。
