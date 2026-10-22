# 练习状态迁移只读复核（5 个有界案例）

日期：2026-10-08。代码基线为本轮读取失败修复前的 `lib/dialogue-practice-keys.ts`、`lib/dialogue-plan.ts` 与 `components/dialogue-practice.tsx`。只读脚本 `/tmp/round5-migration-readonly-probe.ts`，输出 `/tmp/round5-migration-readonly-probe.json`；用 `npx tsx /tmp/round5-migration-readonly-probe.ts` 复跑。未修改源码，未运行全 verify 或浏览器。

| 案例 | 实际证据 | 结论 |
| --- | --- | --- |
| 原场景身份与旧别名 | 662 个冻结原场景对应当前662个，3564个显示别名，无冲突别名归属或重复原身份 | 当前数据范围通过；新增资产仍需根代理再次核查 |
| 多旧键合并 | 两份旧文本保留；referenceSeenAt合并为25，practiceStartedAt保留更早18 | 不因迁移恢复首次资格 |
| 清空与恢复旧稿 | canonical文本清空后保持空，参考证据仍在；首次独立API阻断；两旧稿可取回 | 清空不回填，恢复不删历史 |
| 备份同键冲突与重复导入 | 本地当前文本保留，传入文本和原首次稿存冲突副本；重复导入不再增加同副本 | 当前案例不丢冲突稿 |
| getItem抛错 / 坏JSON | loadDialoguePlan返回默认空计划，调用者applyStored会将可见文本与历史状态清空；此流程没有实际存储写入 | 确认待修读取边界 |

## 读取失败问题

`loadDialoguePlan` 将没有保存记录与读取失败/损坏合并为默认计划；组件 `restore` 的 `protectChange` 只识别此前保存错误。没有此前保存错误的用户点击恢复时，`applyStored(default)` 会把已显示文本清空，参考与练习标记消失，看起来获得首次资格。`updateStoredPlan` 会拒绝向失败存储写入，所以本复核没有声称真实已保存历史被覆盖；风险是界面暂时失去当前可见证据和状态。

已通知根代理与代码作者。代码作者确认正在窄加严格read结果，以区分真实无记录与失败，初始化/换任务/恢复时失败保留当前状态并阻断未加载任务操作，补受控读取失败和恢复正常测试。本文不提前声称该修复通过；根代理整合后需对最终代码和测试复核。

## 限制

这是5个受控内存存储案例与现有身份数据检查，不是实际浏览器存储故障测试、24小时延迟实测或全部未来迁移情况证明。没有独立母语审校或学习掌握结论。

## 严格读取窄修后的只读复核

代码作者窄加 `readDialoguePlan` 后，已读取组件全部三个受影响入口：初始化失败保持已有可见值并setReady(false)；restore只在loaded=true调用applyStored；chooseTask切换前预读失败直接返回；未加载状态禁用草稿输入/保存/揭晓/首次独立相关操作。没有把loadDialoguePlan兼容默认返回直接应用于这些入口。

实际执行：`npx tsx --test --test-name-pattern 'strict practice reads' scripts/dialogue-practice-state.test.ts`，1个targeted测试通过，覆盖getItem抛错、坏JSON保留原证据、存储恢复后读回原记录和真实空存储首次访问。此前待修读取项在这组受控测试和代码入口范围内已解决。其余4例与旧失败probe作为历史证据保留；没有把它改写成从未出现问题。未新增浏览器故障实测或全verify通过声明。
