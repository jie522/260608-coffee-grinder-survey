# CLAUDE.md — 手搖磨豆機市場調查問卷系統

> 這份文件讓 Claude Code 快速理解此專案的架構、修改方式與注意事項。

---

## 專案概覽

**目的：** 手搖磨豆機進階消費者研究問卷，收集受訪者使用行為、痛點、購買意願與價格敏感度。

**技術棧：**
- **後端：** Node.js 原生 `http` 模組（無框架），單一 `server.js`
- **前端：** 純 HTML + CSS + Vanilla JS（無框架，無打包工具）
- **資料儲存：** JSON 檔案（`data/responses.json`）
- **圖表：** Chart.js v4.4.0（CDN）
- **設計系統：** Starbucks Design System（DESIGN.md from voltagent/awesome-design-md）
- **部署：** Railway（GitHub 推送自動部署）

---

## 檔案結構

```
survey/
├── server.js          # Node.js HTTP 伺服器，所有 API 路由
├── questions.json     # ★ 問卷題目定義（改題目只需動這個）
├── index.html         # 問卷填寫頁面（含完整 JS 邏輯）
├── admin.html         # 後台管理頁面（Chart.js 統計圖、備份/回存）
├── style.css          # 問卷頁面樣式（Starbucks 暖米色主題）
├── admin.css          # 後台樣式（Starbucks 深綠暗色主題）
├── package.json       # { "start": "node server.js" }，無外部依賴
├── .gitignore         # 排除 data/ node_modules/ .env
├── CLAUDE.md          # 本文件
└── data/
    └── responses.json # 所有填寫回覆（自動建立，不進 git）
```

---

## 本地開發

```bash
cd "D:\claude code\07 咖啡問卷調查\survey"
node server.js
# 問卷：http://localhost:3000
# 後台：http://localhost:3000/admin  密碼：maxclaw
```

**重啟伺服器（改完 questions.json 後必須重啟）：**
```powershell
Stop-Process -Name "node" -Force
node server.js
```

---

## API 端點一覽

| 方法 | 路徑 | 說明 | 驗證 |
|------|------|------|------|
| GET | `/` | 問卷頁面 | — |
| GET | `/admin` | 後台頁面 | — |
| GET | `/api/questions` | 讀取題目 JSON | — |
| POST | `/api/submit` | 提交問卷答案 | — |
| POST | `/api/admin/login` | 後台登入，回傳 token | — |
| GET | `/api/admin/stats` | 統計資料（含圖表用） | Bearer token |
| GET | `/api/admin/export` | 下載 CSV（BOM 相容 Excel） | Bearer token |
| GET | `/api/admin/backup` | 下載完整 responses.json | Bearer token |
| POST | `/api/admin/restore` | 回存 JSON 陣列（自動備份舊資料） | Bearer token |
| GET | `/api/admin/count` | 回覆筆數 | Bearer token |

**Token 機制：** `Buffer.from(adminPassword).toString('base64')`，登入後前端存在記憶體 `token` 變數。

---

## 環境變數（Railway 部署）

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `PORT` | 3000 | Railway 自動注入 |
| `ADMIN_PASSWORD` | `maxclaw` | 後台密碼，Railway 上設定 |
| `DATA_DIR` | `./data` | 資料目錄，Railway Volume 掛載點設為 `/data` |

---

## questions.json 結構

```
questions.json
└── sections[]           ← 10 個部分（S1–S10）
    └── questions[]
        ├── id           ← "Q1"、"Q3A" 等（跳題邏輯的依據，勿改）
        ├── type         ← 見下表
        ├── text         ← 題目文字
        ├── options[]    ← 單選/多選題用
        ├── items[]      ← Likert / 排序 / VW 題用
        ├── showIf       ← 顯示條件字串（前端解析）
        └── skipLogic[]  ← 選特定選項後跳過哪些題
```

### 題型（type）

| type | 說明 | 後台統計 |
|------|------|----------|
| `single` | 單選，選項用 radio | 甜甜圈圖 |
| `multiple` | 多選，可加 `maxSelect` 限制上限 | 水平長條圖 |
| `likert` | 五點量表，需 `items[]` + `scale.minLabel/maxLabel` | 水平長條圖（依平均分著色） |
| `ranking` | 排序題，需 `items[]` + `selectCount` | 不顯示於後台 |
| `vanwestendorp` | 價格敏感度四題填空，需 `items[]` + `currency` | 不顯示於後台 |
| `open` | 開放式，可加 `placeholder` | 不顯示於後台 |

### 選項欄位

| 欄位 | 說明 |
|------|------|
| `id` | 選項代號（A/B/C…），儲存在 CSV 的欄位值 |
| `text` | 顯示文字 |
| `skipTo: "END"` | 選此項則直接結束問卷（篩選出局） |
| `hasInput: true` | 選項後顯示文字輸入欄（如「其他：___」） |
| `setFlag: "lightweight"` | 選此項設定輕量版旗標 |

---

## 跳題邏輯系統

跳題在 **前端** `computeSkips()` 函式計算，每次 Q3 / Q3A 作答後觸發。

### 規則一覽

| 條件 | 跳過題目 |
|------|----------|
| Q1 選 C 或 D | → 結束問卷（END 畫面） |
| Q2 選 C | → 結束問卷（END 畫面） |
| Q3 未包含 A（無手搖磨豆機） | Q3A, Q3B, Q12, Q13, Q14, Q15 |
| Q3 只選 D（預磨粉） | 上述 + Q17, Q19, Q25 |
| Q3A 選 A（NT$1000以下，輕量版） | Q17, Q18, Q19, Q20, Q21, Q22 |

`questionOrder` 是實際顯示的題目序列（已過濾跳過題），每次 `computeSkips()` 重建。

---

## 問卷分節（10 個部分）

| ID | 標題 | 題號 |
|----|------|------|
| S1 | 篩選題 | Q1, Q2, Q3, Q3A, Q3B |
| S2 | 使用者輪廓 | Q4–Q8 |
| S3 | 咖啡習慣 | Q9–Q11 |
| S4 | 手搖磨豆機使用行為 | Q12–Q16 |
| S5 | 現有手搖磨豆機滿意度 | Q17–Q19（Likert） |
| S6 | 新產品概念測試 | Q20–Q22 |
| S7 | 功能偏好排序 | Q23–Q24（ranking） |
| S8 | 價格敏感度 | Q25（Van Westendorp） |
| S9 | 品牌與通路 | Q26–Q28 |
| S10 | 開放性回饋 | Q29–Q30 |

---

## 後台管理

URL：`/admin`，密碼：環境變數 `ADMIN_PASSWORD`（預設 `maxclaw`）

**功能：**
- 📊 各題統計圖表（單選→甜甜圈、多選/Likert→水平長條）
- ⬇ 匯出 CSV（UTF-8 BOM，可直接用 Excel 開啟中文）
- 🗂 備份 JSON（下載完整 responses.json，檔名含時間戳）
- ⬆ 回存資料（上傳備份 JSON，覆蓋前自動備份舊資料到 data/）
- ↻ 每 30 秒自動重新整理

---

## 設計系統（Starbucks）

來源：`voltagent/awesome-design-md` → `design-md/starbucks/DESIGN.md`

| Token | 值 |
|-------|----|
| 頁面背景 | `#f2f0eb`（Neutral Warm） |
| 主標題色 | `#006241`（Starbucks Green） |
| CTA / 按鈕 | `#00754A`（Green Accent） |
| 深綠背景（Header） | `#1E3932`（House Green） |
| 金色（badge） | `#cba258`（Gold） |
| 按鈕圓角 | `50px`（全站 pill，不可改為方角） |
| 卡片圓角 | `12px` |
| 輸入框圓角 | `4px` |
| 陰影 | 雙層低透明度（0.5px + 1px） |
| 按鈕 active | `transform: scale(0.95)` |

**RWD 斷點：**
- `< 480px`：手機，按鈕等寬，Likert 橫向捲動
- `480–767px`：平板
- `≥ 1024px`：桌機

---

## 常見修改場景

### 改題目文字
直接修改 `questions.json` 中對應 `id` 的 `text` 欄位，重啟伺服器。

### 新增選項
在 `options[]` 末尾加 `{ "id": "X", "text": "新選項" }`，id 用下一個未使用字母。

### 讓某題結束問卷
```json
{ "id": "D", "text": "幾乎不喝", "skipTo": "END" }
```

### 新增 Likert 子項目
在 `items[]` 加入 `{ "id": "Q19_X", "text": "新評估項目" }`，id 格式同父題 id + 底線流水號。

### 改排序題選取數量
修改題目的 `selectCount` 欄位（目前 Q23=5, Q24=3）。

### ⚠️ 改 id 的注意事項
題目 `id` 是 `showIf` / `skipLogic` 的依據，改了 id 必須同步更新所有引用處（`questions.json` + `index.html` 的 `computeSkips()`）。

---

## 部署（Railway）

**流程：** 推送到 GitHub main branch → Railway 自動偵測並重新部署（約 1–2 分鐘）

```bash
git add <files>
git commit -m "描述"
git push
```

**Railway 設定：**
- Service：連結 GitHub repo `jie522/260608-coffee-grinder-survey`
- Volume：掛載到 `/data`，對應環境變數 `DATA_DIR=/data`
- 環境變數：`ADMIN_PASSWORD`、`DATA_DIR`

**注意：** 在 Railway Canvas 修改設定後，必須點 **Deploy** 才會生效；只存草稿不會重新部署。

**費用：** Railway Hobby Plan $5/月 + 用量（此專案實際約 $1–2/月）。

---

## 資料格式（responses.json）

每筆回覆為一個 JSON 物件，結構範例：

```json
{
  "id": "uuid-v4",
  "submittedAt": "2026-06-08T10:30:00.000Z",
  "Q1": "A",
  "Q2": "B",
  "Q3": ["A", "B"],
  "Q3A": "C",
  "Q4": "B",
  "Q19_1": 4,
  "Q19_2": 3,
  "Q25": { "too_cheap": "800", "cheap": "1500", "expensive": "5000", "too_expensive": "8000" },
  "Q30": "開放題文字回答",
  "_version": "v4",
  "_lightweight": false,
  "_completedAt": "2026-06-08T10:35:12.000Z"
}
```

多選題答案為陣列，Likert 子項目為各自獨立欄位（`Q19_1`、`Q19_2`...），VW 題為物件。
