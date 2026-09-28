# 周光 Weeklight：Windows 开源日程管理、桌面日历与待办清单

周光（Weeklight）是一个 **免费开源的 Windows（Win）日程管理项目**，提供适用于 **Windows 10 / 11 x64** 的 EXE 安装包。通过桌面日历、待办清单和日 / 周桌面便签安排学习与工作，用四周规划和周时间表管理未来几周，再通过定时提醒跟进每一项计划。

应用使用 Electron 构建，提供可直接安装的 Windows EXE 安装包，无需单独安装 Node.js 或浏览器。计划与设置保存在当前 Windows 用户的数据目录中，支持离线使用，无需注册账号。源码采用 MIT 许可证。

Weeklight is a free, open-source Windows calendar planner and to-do list app with desktop sticky notes, weekly planning, scheduled reminders, and offline local storage.

![周光 Windows 日程管理软件：四周日历、任务分类和周计划](docs/images/calendar.png)

## 下载与安装

**[下载 Windows 安装包（1.1.2，x64）](https://github.com/OrangeCatzhang/weeklight/releases/download/v1.1.2/Weeklight-Setup-1.1.2.exe)** · [全部版本与校验文件](https://github.com/OrangeCatzhang/weeklight/releases)

源码托管在 GitHub，安装 EXE 通过 GitHub Releases 公开分发，不进入源码仓库。

下载安装包后直接运行，按提示选择安装位置。终端用户无需安装 Node.js 或编译工具。安装版可创建桌面与开始菜单快捷方式，并可在设置中启用开机启动。

当前版本 **1.1.2**。安装包尚未使用商业代码签名证书；Windows 可能显示未知发布者。请核对下载来源和发布页提供的 SHA-256。

## 功能

- **四周日历与周计划**：查看未来几周的安排，切换四周日历、周时间表和任务清单。
- **待办事项（To-do List）与已办清单**：按计划日期整理任务，勾选完成或撤销完成，支持只看待办或已办。
- **日 / 周桌面便签**：在独立桌面小窗口查看当天或本周清单，快速新增任务，与主日历同步。
- **默认沉底与置顶**：便签打开、取消置顶或失去焦点后回到普通窗口下方；图钉可切换置顶，仍可正常输入和勾选。
- **分类、搜索与改期**：按工作、学习、生活分类，用 Ctrl+K 搜索名称和备注，拖动日历任务调整日期或时段。
- **每周重复计划**：生成连续 4、8 或 12 周的独立事项，分别编辑、完成和删除。
- **定时提醒与日程提醒**：到点或提前提醒，系统通知与独立提醒弹窗，支持稍后 10 分钟提醒及恢复后补发。
- **系统托盘与开机启动**：关闭主窗口后继续在后台提醒；安装版可在设置中选择开机启动。
- **便签外观与位置恢复**：三种配色，控制已办清单显示，拖动和缩放窗口，保存位置、大小及视图设置。
- **本地保存与 JSON 备份**：支持离线规划、备份导出与合并导入；保存采用临时文件替换，并保留上一份数据副本。

## 使用场景

- **学习计划与备考安排**：安排复习、阅读、作业和课程，用每周计划表分配学习时段。
- **工作日程与任务管理**：整理会议、项目节点和日常工作清单，改期后继续跟进待办事项。
- **电脑桌面待办与便签**：随时查看今天或本周要做的事，直接勾选，必要时置顶。
- **个人时间管理与生活计划**：在桌面日历中安排未来几周，为运动、课程和日常事务设置提醒。

## Windows 日程管理与桌面待办：开始使用

点击「新建计划」或按 **N**。单击日期查看当天计划，双击空白日期创建；点击已有计划编辑。**Ctrl+K** 搜索名称与备注。

从主窗口右上角「桌面便签」或托盘菜单打开便签。日 / 周按钮切换范围；箭头翻页，日期框跳转，「今天」恢复跟随当前日期。拖动顶部移动，拖动边缘调整大小；「⋯」调整颜色和已办显示。

关闭主窗口后，托盘和提醒继续运行。需要彻底停止时，在托盘选择「退出周光」，或使用设置中的退出按钮。关闭便签只隐藏便签。

![Windows 桌面待办便签：日计划、待办事项与已办清单](docs/images/widget-day.png)

### 运行边界

关机、休眠或应用退出期间不能即时提醒；再次运行或恢复后会补发仍未完成、尚未提醒的事项。Windows 通知权限和专注助手可能影响系统通知，独立提醒弹窗可在设置中控制。

便签是独立窗口，没有嵌入资源管理器桌面。**Win+D / 显示桌面可能把便签一起隐藏**，可从主窗口或托盘重新打开。待办与已办按计划日期分组，每周重复生成的事项独立编辑。

## 常见问题

### 免费开源版包含什么

当前仓库提供 MIT 许可的完整应用源码，Releases 提供免费 Windows 安装包。日历、待办清单、桌面便签与提醒功能均包含在此版本中。

### 桌面便签与日历中的待办是否同步

便签按所选日期或周显示同一份计划数据，勾选完成、撤销完成和新增任务会同步到主日历。适合需要把今天或本周任务放到电脑桌面上查看的用户。

### 离线日程管理是否需要注册

无需注册，计划、提醒状态和设置都保存在本机。日常安排与任务管理可以离线使用；跨电脑迁移可导出和导入 JSON 备份。

### 下载的 EXE 是安装包还是单文件程序

下载的 `Weeklight-Setup-1.1.2.exe` 是安装程序。安装后通过桌面或开始菜单启动周光，无需额外安装 Node.js。它不是可独立拷走运行的单文件应用；从源码构建的免安装目录需完整保留 `win-unpacked` 文件夹。

## 数据与隐私

默认使用 Electron 的当前用户应用数据目录；在 Windows 上通常位于 `%APPDATA%\weeklight`。实际路径可在「设置与备份」中查看或打开。数据文件为 `plans.json`，上一份保存副本为 `plans.json.bak`。升级应用通常保留此目录；卸载或迁移前建议导出备份。

可通过 `WEEKLIGHT_DATA_DIR` 环境变量指定其他目录。应用不会主动查找或迁移其他路径中的数据。早期测试版本用户可先从旧版导出 JSON，再在新版中导入。

应用没有账户服务、云同步或遥测。源码和公开安装包不包含个人计划、备份、浏览器缓存或本机验证报告。

## 从源码运行

需要 **Windows x64、Node.js 22.12 或更高版本、npm**；本项目使用 Node.js 24 验证。原生层级助手由系统的 .NET Framework C# 编译器构建（Windows 10 / 11 的 .NET Framework 4.x 环境）。

```powershell
git clone https://github.com/OrangeCatzhang/weeklight.git
cd weeklight
npm ci
npm start
```

`npm start` 会先编译原生助手。普通用户使用安装包即可。

### 验证与构建

```powershell
npm test
npm run test:widget
npm run test:layer
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1
npm run test:packaged
```

桌面测试需要可交互的 Windows 桌面，并使用独立测试数据。构建结果在 `outputs/weeklight-1.1.2/`：`Weeklight-Setup-1.1.2.exe` 为安装包，`win-unpacked/周光.exe` 可直接运行（需保留整个 `win-unpacked` 文件夹）。

`npm run test:ui` 提供额外的主日历回归验证。可选的 `scripts/prepare-runtime.cjs` 用于离线准备 Electron，需要 Python 和匹配校验值的官方 Electron ZIP；正常 `npm ci` 不需要运行它。

## 项目结构

- `src/main.cjs`：桌面窗口、托盘、数据与提醒。
- `src/core.cjs`、`src/data-path.cjs`：计划校验、提醒判定和数据目录。
- `src/renderer.js`、`src/style.css`：主日历界面。
- `src/widget-*`：桌面便签模型、窗口与界面。
- `src/native/WindowLayer.cs`：仅调整应用窗口层级的 Windows 原生助手。
- `tests/`：数据边界、交互、原生层级与打包验证。

## 开源与反馈

本项目代码按 [MIT 许可证](LICENSE) 开源。Electron、Chromium 及其他依赖遵循各自许可证；二进制发行保留随附的第三方许可文件。

欢迎通过 [Issues](https://github.com/OrangeCatzhang/weeklight/issues) 反馈问题。提交截图或日志前请移除个人计划内容。

界面组织参考 [TickTick](https://www.ticktick.com/windows)、[Notion Calendar](https://www.notion.com/product/calendar) 和 [Apple 界面指南](https://developer.apple.com/design/human-interface-guidelines/)，代码与页面为独立实现，与这些产品没有隶属关系。
