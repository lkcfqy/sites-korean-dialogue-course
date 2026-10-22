# 韩语对话课

[韩语对话课](https://your-site.example) 是按课程阅读的韩中对照页面：每句韩语下方直接显示中文翻译，支持本课、场景和单句朗读，以及点击词语查看释义、词形、用法和听发音。保留周次、课程选择和上一课／下一课导航。

当前阅读版包含26周、156节主课，以及1节补充对话，共532段对话、7752条双语台词。只展示原课程中的独立对话，不展示自己录音、练习、测评、学习计划或复习功能。原来的26个复习日没有新对话，已从目录移除；旧链接转到对应周的第一课。

## 内容与生成

原始课程保留在 `public/immersion/`，历史教学组件与数据保留供维护参考。阅读页不导入录音、练习或测评组件，也不读写历史学习记录。

运行以下命令生成精简的每日阅读数据及服务端加载表：

```sh
node scripts/build-reader-data.mjs
```

输出为 `public/reader/index.json`、`public/reader/lessons/*.json` 及 `data/reader-loaders.ts`。生成器只选取 `kind === "dialogue" && !review` 的场景，保留台词原文、中文、角色、场景键和句子 ID，保留点词所需词注，剔除重复复习。课程正文直接在服务端渲染；客户端提供导航、点词弹层及朗读。

韩中对话为原创教学材料，尚未经独立母语教师全量审校。历史词典素材来自国立国语院韩国语基础词典，原署名和 CC BY-SA 2.0 KR 许可记录保留在历史数据及文档中；点词查看保留词典来源署名。

## 开发与校验

```sh
npm run install:ci
npm run dev
npm run typecheck
npm test
npm run check:content
npm run build
```

本副本的 Sites 项目 ID 为占位符；部署前必须填写自己的项目并单独配置访问范围。`build/sites-vite-plugin.ts` 保留 Sites 构建集成。历史教学功能的维护说明和审查记录位于 `docs/`；当前产品范围以本说明为准。

## 公开源码来源

- 导出日期：2026-10-22（UTC）。
- Sites 源版本：**v17**。
- 原始源码提交：`ddb9dfc21d30c7172c1c0e6f176eeb5b95315429`。
- 本仓库为净化后的源码快照，不带原 Git 历史；部署配置已占位化，文件不声称与原始提交逐字节一致。

### 运行环境和配置

需要 Node.js **>=22.13.0** 和 npm。干净工作树默认使用 `portable` 执行配置，按上文 `npm run install:ci` 安装锁定依赖，然后 `npm run dev`。生产构建用 `npm run build`；构建后可用 `npm start` 在本机 Wrangler Worker 环境预览（仅监听 127.0.0.1）。

本阅读应用没有必填的私人 API 密钥。可选本机工具路径配置可参考 `.env.example`；不要提交自己的 `.env`。`.openai/hosting.json` 的 `YOUR_SITES_PROJECT_ID` 必须替换为自己的 Sites 项目；原网站的访问配置、登录身份和数据库均未复制。保留 `build/sites-vite-plugin.ts` 的构建集成，生产托管须自行配置。

朗读使用非官方 Edge Read Aloud 协议及公开客户端协议常量，并非用户个人密钥。该外部服务可能变更、限流或不可用，接口可用性和服务条款须由部署者核实。此导出未执行线上朗读请求或部署。

### 内容与隐私清理

`data/`、`public/immersion/`、`public/reader/`、`public/word-usage/` 是教学语料、词典释义、索引、词形注释及内容审查统计，不是用户学习记录或真实聊天导出；为保证课程及点词功能完整，保留必要静态 JSON。词典中的 `conversation` 表示词典示例对话，`token` 在注释夹具中表示词语，不是认证令牌。

不包含原 `.git`、`node_modules`、构建产物、TypeScript 构建缓存、历史验证日志/截图、个人学习记录、数据库导出或账号凭据。删除历史部署验收与内部目标审计文档，其余教学维护说明保留；其中历史路径仅为教学数据生成来源说明，不保证在本机存在。

首次公开快照只完成静态身份/凭据扫描、数据结构检查、JSON 解析和 JavaScript 模块语法检查，当时未安装依赖或运行完整测试、类型检查和构建。后续提交由 [GitHub Actions](https://github.com/lkcfqy/sites-korean-dialogue-course/actions/workflows/verify.yml) 使用锁定依赖执行格式、Lint、类型、测试、内容审查、构建和生产依赖安全检查；请以对应提交的运行结果为准。文档内既有历史测试结论不等于本净化副本的新验证结果。

### 第三方许可

国立国语院韩国语基础词典（한국어기초사전）素材沿用 **CC BY-SA 2.0 KR**：词条内的来源、版本与许可字段，以及 `data/curriculum/usage-provenance.json` 等来源记录均保留。第三方样式和 Sites 构建插件的原许可文件一并保留。未为整个项目新增或选择开源许可证；公开仓库本身不等于授予新的项目许可，第三方素材仍受其各自许可约束。
