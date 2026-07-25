# 07_UI_ENGINE.md

# Mockup Photoshoot Director — UI & Workflow Engine Specification

**Document type:** UX / Application Workflow Specification (operational, not visual design)
**Sources of truth (only):** `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, `06_PROMPT_ENGINE.md`
**Status:** Authoritative baseline for engineering
**Scope note:** Specification only — no application code, no React/HTML/CSS, no implementation. This is the operational contract for every screen, state, button, workflow, and interaction. Everything is deterministic. **The interface language is Arabic only (RTL); generated prompt text remains English only** (`06_PROMPT_ENGINE.md` §20). In this document, Arabic UI strings are given with an English gloss in parentheses *for the engineering reader*; the shipping UI shows the Arabic only.

`§` = `01_PRD.md`. `ARCH` = `02_ARCHITECTURE.md`. `DM` = `03_DATA_MODELS_FINAL.md`. `RE` = `04_RULE_ENGINE_REVISED.md`. `SE` = `05_SCENE_ENGINE.md`. `PE` = `06_PROMPT_ENGINE.md`.

---

## 0. Global UI Principles

1. **Deterministic UI.** Every control's visibility/enabled/disabled state is a pure function of the persisted state (`PhotoshootSession.status`, `GenerationProgress`, `ValidationResult`, DM). Identical state → identical UI. No hidden non-determinism.
2. **Nothing generates by itself.** Image generation is never automatic. The UI only *composes and copies* prompts; the user runs them in their image tool (§24). There is always a visible, explicitly-labeled action to advance.
3. **One prompt = one image (surfaced).** Every copy/execution control reflects PE §3: A and B are separate requests; no control ever implies "generate A+B at once."
4. **Print Area is supreme.** Print-area blocking failures always halt and are shown first (RE §2; §11 here).
5. **Blocking halts; warnings never mutate.** A blocking validation stops progress with a clear reason; a warning is advisory and never silently changes a selection (RE §13).
6. **Arabic-only, RTL.** All labels, messages, toasts, dialogs are Arabic and right-to-left. Numerals, prompt previews, and hashes render LTR within the RTL layout. Prompt output is English (PE §20).
7. **No destructive surprise.** Reset/Delete/Overwrite/Replace always confirm (§14). Autosave protects work (§21).

---

## 1. Application Philosophy — Three Modes

The app offers three progressive modes over the **same** deterministic engine chain; modes change *how much is exposed*, never *what the engine does*.

| Mode | Arabic label | For whom | Exposes |
|---|---|---|---|
| **Quick** | الوضع السريع | new users / fast catalog runs | season, products, colors, audience, scene count → one-click Plan + Generate prompts. Sensible deterministic defaults for scenes, groups, display methods. |
| **Advanced** | الوضع المتقدم | regular Etsy sellers | Quick + Scene Planner, Group Manager, Color Manager, per-scene view/display/hero-support control. |
| **Professional** | الوضع الاحترافي | power users / agencies | Advanced + Prompt Preview (resolved variables, versions, checksums), Execution Center queue, rule-trace visibility, full copy/export matrix, settings for defaults. |

Mode is a **view filter**, not a data fork: a session created in Quick opens losslessly in Professional. Switching modes never alters the `PhotoshootSession` or triggers regeneration (idempotence, ARCH §1.3).

---

## 2. Complete Navigation Hierarchy

Top-level RTL navigation (right-anchored):

```
الرئيسية (Home)
المشاريع (Projects)
  ├─ جلسة سريعة (Quick Session)
  └─ جلسة متقدمة (Advanced Session)
مخطط الجلسة (Photoshoot Planner)
  ├─ مدير المنتجات (Product Manager)
  ├─ مدير الألوان (Color Manager)
  └─ مخطط المشاهد (Scene Planner)
معاينة البرومبت (Prompt Preview)
مركز التنفيذ (Execution Center)
مدير المجموعات (Group Manager)
مدير الغلاف (Cover Manager)
مركز التصدير (Export Center)
الإعدادات (Settings)
المساعدة (Help)
حول (About)
```

Navigation gating (mirrors ARCH §7 + SE/PE pipeline): Planner → Prompt Preview → Execution → Cover → Export are **sequentially unlocked**. Prompt Preview/Execution unlock only after Validation passes; Cover Manager unlocks only when `generationProgress.allOutputAReady === true` (RE §8); Export unlocks when there is at least one generated artifact. Locked items are visible but disabled with a tooltip explaining the gate (never hidden — §24).

---

## 3. Screen Catalog (per-screen contract)

Each screen defines: Purpose, Inputs, Outputs, Buttons, Warnings, and the four transient states (Empty / Loading / Busy / Error). Common transient-state rules apply to all screens:

- **Empty:** friendly Arabic guidance + the single primary next action.
- **Loading:** skeleton placeholders (§19); no spinner-only blank screens.
- **Busy:** controls that would mutate state are `Busy` (disabled + inline progress); read controls remain usable.
- **Error:** inline Arabic error with the blocking `RULE_*`/`PROMPT_*` code and a recovery action (§20/§21).

### 3.1 Home (الرئيسية)
- **Purpose:** entry point; recent projects, new session, resume.
- **Inputs:** `recentProjects` (DM `Project`), autosave marker.
- **Outputs:** navigation intent.
- **Buttons:** جلسة جديدة (New Session), فتح مشروع (Open), استئناف آخر عمل (Resume last), الإعدادات.
- **Warnings:** "لديك عمل غير محفوظ" (unsaved work) if autosave pending.
- **Empty:** no projects → prompt to create the first session.

### 3.2 Projects (المشاريع)
- **Purpose:** list/manage projects (Project Manager §21 surface).
- **Inputs:** `Project[]`, `VersionSnapshot` history.
- **Outputs:** open/duplicate/rename/delete intents.
- **Buttons:** فتح، إنشاء نسخة (Duplicate), إعادة تسمية (Rename), حذف (Delete), السجل (History).
- **Warnings:** delete confirm (§14); version-mismatch badge if a project needs migration (DM §16).

### 3.3 Quick Session (جلسة سريعة)
- **Purpose:** minimal 5-field session build → plan.
- **Inputs:** season, `productIds`, `colorSelection`, `audience`, `requestedSceneCount`.
- **Outputs:** an assembled `PhotoshootSession` ready to validate.
- **Buttons:** تخطيط الجلسة (Plan), التحقق (Validate), توليد البرومبتات (Generate Prompts — composes text, not images).
- **Warnings:** live validation chips (§4).

### 3.4 Advanced Session (جلسة متقدمة)
- Quick Session + entry points to Product/Color/Scene planners. Same outputs; more control.

### 3.5 Photoshoot Planner (مخطط الجلسة)
- **Purpose:** the working hub; scene list, hero/support, per-scene inspector (SE §5/§10).
- **Inputs:** assembled `Scene[]`, resolved constraints.
- **Outputs:** edited `sceneOrder`, per-scene overrides (view/display within legal sets).
- **Buttons:** إضافة مشهد بديل (Replace Scene), تثبيت المشهد (Lock Scene), تكرار (Duplicate), حذف (Delete), توسيع/طي (Expand/Collapse).
- **Warnings:** duplicate-signature warning, print-area warning, feasibility warning (`RULE_CNT_001`).

### 3.6 Prompt Preview (معاينة البرومبت)
- **Purpose:** view resolved Output A/B prompts, variables, metadata, checksums (PE §19).
- **Inputs:** `OutputA/B.promptText`, `PromptMetadata`, `promptHash`.
- **Outputs:** copy actions.
- **Buttons:** the copy matrix (§11), عرض المتغيرات (Show variables), عرض النسخة/التحقّق (Show version/checksum).
- **Warnings:** unresolved variable (`PROMPT_VAR_001`), invalid module version (`PROMPT_MOD_001`).

### 3.7 Execution Center (مركز التنفيذ)
- **Purpose:** ordered A-then-B execution queue with per-item state (§10).
- **Inputs:** execution plan (PE §17), `PromptExecutionState` (derived, PE §6).
- **Outputs:** copy per item, mark done, retry/skip/cancel.
- **Buttons:** نسخ (Copy), تم (Mark done), إعادة المحاولة (Retry), تخطّي (Skip), إلغاء (Cancel).
- **Warnings:** blocked item reason (missing A / missing PNG / stale).

### 3.8 Group Manager (مدير المجموعات)
- **Purpose:** view/edit groups + group copy/plan (§8; SE §18).
- **Buttons:** دمج (Merge), تقسيم (Split), نقل مشهد (Move scene), نسخ المجموعة/‌A/‌B/خطة التنفيذ (Copy Group / A / B / Plan).

### 3.9 Cover Manager (مدير الغلاف)
- **Purpose:** review cover metadata + compose/copy Cover Prompt (SE §19; PE §18).
- **Gate:** disabled until `allOutputAReady` (RE §8) with tooltip "بانتظار اكتمال صور البيع" (waiting for all Sale Images).
- **Buttons:** معاينة برومبت الغلاف (Preview Cover Prompt), نسخ الغلاف (Copy Cover).
- **Warnings:** cover-uses-B guard (`PROMPT_COV_001`/`RULE_COV_001`) — structurally impossible, surfaced if migrated data offends.

### 3.10 Export Center (مركز التصدير)
- **Purpose:** TXT/JSON/ZIP + copy scopes (§12 PRD; DM `ExportScope`/`ExportFormat`).
- **Buttons:** نسخ الكل (Copy All), تصدير TXT/JSON/ZIP, نسخ خطة التنفيذ الكاملة.

### 3.11 Settings / Help / About (الإعدادات / المساعدة / حول)
- Settings §22; Help = workflow guidance + shortcut list; About = app/version/library info (DM `schemaVersion`s).

---

## 4. Session Builder Workflow (beginning → generation)

A guided, gated, RTL stepper. Each step validates locally; the global Validation gate (RE §14) runs before generation. No step can be skipped; steps 6+ lock behind validation.

```
1. جلسة جديدة (New Session)  → name; choose Mode (§1)
2. الموسم (Season)          → exactly one SeasonId (§7)
3. المنتجات (Products)       → 1..n productIds (§6)
4. الألوان (Colors)          → colorSelection (+ lock) (§8; garment-color domain)
5. الجمهور (Audience)        → Audience (RE §17.1); Kids-product guard live
6. عدد المشاهد (Scene Count) → requestedSceneCount ≥ 1; feasibility precheck (SE §6.4)
7. المجموعات (Groups)        → groupBy default (product) + overrides (§8)
8. القواعد (Rules)           → read-only view of active constraints + rule trace (RE §15)
9. التحقق (Validation)       → blocking gate; failures listed with Arabic messages (RE §14)
10. التخطيط (Planning)       → Scene Engine assembles scenes deterministically (SE §2)
11. التوليد (Generation)     → Prompt Engine composes A/B prompt TEXT (not images) (PE §2)
12. التصدير (Export)         → copy/export (§11; PE §15)
```

Step behaviors:

- Steps 2–7 update the session live; each shows validation chips (green pass / amber warning / red blocking).
- Step 9 is the **only** path to Planning/Generation (RE §14). A red gate lists every blocking failure with its code + Arabic message + responsible field (RE §15); the "توليد البرومبتات" button is `Blocked` until all clear.
- Step 11 composes prompt text only; a distinct later action ("توليد الصور" guidance) tells the user to run prompts in their image tool — the app never auto-generates images (§0.2, §24).

---

## 5. Scene Planner UI

### 5.1 Scene list
Ordered by `sceneOrder` (DM §3.2). Each row shows: number (`{n}`, PE §14), hero/support badge (SE §10), product, color swatch, view, display method, print-area status, duplicate status, and A/B output chips.

### 5.2 Interactions (deterministic)

| Action | Arabic | Behavior | Guard |
|---|---|---|---|
| Drag & Drop reorder | سحب وإفلات | reorders `sceneOrder`; renumbering is deterministic (PE §14) | drop only into valid list positions; invalid drops snap back (§24) |
| Move up/down | نقل | keyboard-accessible reorder alternative | — |
| Duplicate | تكرار | clones a scene; new scene gets a fresh `dedupSignature`; if it would duplicate, it is auto-varied or flagged (SE §8) | duplicate-signature blocked (`RULE_DUP_001`) |
| Delete | حذف | removes scene + its A/B; confirm dialog (§14) | recompute `totalScenes` |
| Expand/Collapse | توسيع/طي | opens per-scene inspector (dimensions, print-area preview) | — |
| Hero / Support | مشهد رئيسي / مساند | toggles classification (SE §10); affects order/emphasis | ratio guidance shown |
| Lock Scene | تثبيت المشهد | pins the scene so regeneration/reshuffle won't change it | locked scenes excluded from re-planning |
| Replace Scene | استبدال المشهد | swaps in the next-best deterministic candidate (SE §7) | keeps uniqueness + constraints |

All reorders/edits bump `sceneVersion`; a change to a generation-affecting dimension changes `sceneFingerprint` and marks outputs for regeneration (DM §3.5; §24 prevents stale numbering).

---

## 6. Product Manager (مدير المنتجات)

| Control | Arabic | Behavior |
|---|---|---|
| Add Product | إضافة منتج | adds a `ProductId` to `productIds`; re-checks audience/view legality (RE §17.2) |
| Remove Product | إزالة منتج | removes it; scenes using it are re-planned or flagged |
| Increase scenes | زيادة المشاهد | raises `requestedSceneCount`; feasibility rechecked (SE §6.4) |
| Decrease scenes | إنقاص المشاهد | lowers count; trims lowest-priority support scenes deterministically |
| Color Lock | قفل الألوان | toggles `colorSelection.locked` (garment-color domain, RE §6) |
| Allowed Views | زوايا العرض المسموحة | read-only from `Product.allowedViews`; illegal picks blocked (`RULE_PRD_003`) |
| Allowed Display Methods | طرق العرض المسموحة | filters `DisplayMethod` options per product |
| Allowed Audiences | الجماهير المسموحة | read-only from `audienceConstraints`; Kids-only enforced (`RULE_PRD_001`) |

Kids-product guard: selecting a Kids product with a non-Kids audience shows a blocking chip and disables generation until resolved (RE §17.2; PE §11.1).

---

## 7. Color Manager (مدير الألوان)

| Element | Arabic | Behavior |
|---|---|---|
| Locked colors | الألوان المقفلة | when locked, the set is closed to exactly the selected `ColorId`s (Sand+Navy → Sand+Navy, RE §6) |
| Automatic allocation | التوزيع التلقائي | deterministic round-robin over sorted `ColorId`s across `sceneOrder` (SE §14.2) |
| Priority | الأولوية | hero scenes receive `primaryColor` first (SE §14.2/§19) |
| Manual override | تجاوز يدوي | per-scene color pick, restricted to the locked set (`garmentColorAllowed`) |
| Visual color strip | شريط الألوان | RTL swatch strip showing allocation across scenes |
| Color preview | معاينة اللون | shows the garment color on the scene chip |
| Validation | التحقق | color outside selection → `RULE_PAL_002`; no colors → `RULE_PAL_003` |

Decor/background colors are a **different domain** and never counted against a garment lock (RE §6); the strip labels garment vs decor distinctly.

---

## 8. Group Manager (مدير المجموعات)

- **Automatic grouping:** default `groupBy = product` (DM `GroupBy`); groups formed deterministically by key order (SE §18).
- **Manual grouping:** switch `groupBy` to color/view; regroups deterministically.
- **Move scenes / Merge / Split:** re-partition; all members of a group must share the `groupBy` value (invariant, DM §3.10); illegal moves are blocked.
- **Copy actions:** نسخ المجموعة (Copy Group), نسخ A للمجموعة (Copy Group A), نسخ B للمجموعة (Copy Group B), نسخ خطة التنفيذ (Copy Execution Plan) — each per PE §15/§16, always separate-request semantics with the "each prompt is one image" banner.

Numbering within groups: `{group}.{scene}-A/-B` stable across save/load/export (PE §14; §24).

---

## 9. Prompt Preview (معاينة البرومبت)

| Panel | Arabic | Shows |
|---|---|---|
| Preview Prompt | معاينة البرومبت | resolved English prompt text for a selected `{n}A`/`{n}B` (read-only; English) |
| Preview Variables | المتغيرات | the template variables before resolution |
| Resolved Variables | المتغيرات المحلولة | resolved values (product/color/view/season/…) (PE §2.4) |
| Prompt Metadata | بيانات البرومبت | `PromptMetadata`: templateVersion, moduleVersions, generatorVersion, generatedAt |
| Prompt Versions | إصدارات الوحدات | per-module `SemVer` |
| Prompt Hash | بصمة البرومبت | `promptHash` (LTR) |
| Prompt Checksum | المجموع التحققي | `promptChecksum` (LTR); identical inputs+versions → identical checksum (PE §20) |

Unresolved variables render as a red token with `PROMPT_VAR_001`; the copy button is `Blocked` until resolved.

---

## 10. Execution Center (مركز التنفيذ)

### 10.1 Queue
Two-phase, matching PE §17: **Phase 1** all `{n}A`, then **Phase 2** each `{n}B using {n}A`. The queue never interleaves B before its A.

### 10.2 Per-item state (from `PromptExecutionState`, PE §6 — derived, non-persisted)

| State | Arabic | Meaning | Available actions |
|---|---|---|---|
| Planned | مُخطّط | prompt composed; prerequisites not yet met | نسخ (copy text) |
| Blocked | محظور | missing source A / missing PNG | shows reason; نسخ disabled for B |
| Ready | جاهز | eligible to run (one request) | نسخ, تم (done) |
| Completed | مكتمل | user marked the image produced | إعادة (redo) |
| Stale | قديم | source A changed (`outputB.isStale`) | إعادة التوليد (regenerate) |

### 10.3 Controls
نسخ (Copy the one prompt), تم (Mark done — user confirms they generated that single image), إعادة المحاولة (Retry), تخطّي (Skip — with warning it leaves a gap), إلغاء (Cancel item). The Execution Center **never** runs an image model; it organizes the user's manual, one-image-at-a-time process (§0.2).

---

## 11. Copy System (exact behavior)

All copy actions place **English prompt text** on the clipboard and show an Arabic toast. No copy action ever implies A+B as one request (PE §3/§15).

| Action | Arabic | Clipboard content | Toast (Arabic) |
|---|---|---|---|
| Copy A | نسخ A | one `{n}A` prompt | «تم نسخ برومبت صورة البيع {n}A» |
| Copy B | نسخ B | one `{n}B` prompt (references `{n}A`) | «تم نسخ برومبت المعاينة {n}B» |
| Copy Pair | نسخ الزوج | `{n}A` + `{n}B` as **two separate blocks** + header "نفّذ A أولاً ثم B — طلبان منفصلان" | «تم نسخ الزوج كطلبين منفصلين» |
| Copy Group | نسخ المجموعة | group A+B blocks, scene order, + separate-request banner | «تم نسخ المجموعة {g}» |
| Copy Group A | نسخ A للمجموعة | all group A prompts | «تم نسخ صور البيع للمجموعة {g}» |
| Copy Group B | نسخ B للمجموعة | all group B prompts | «تم نسخ المعاينات للمجموعة {g}» |
| Copy Cover | نسخ الغلاف | Cover Prompt (Sale Images A only) | «تم نسخ برومبت الغلاف» |
| Copy Execution Plan | نسخ خطة التنفيذ | full Phase 1 + Phase 2 plan (PE §17) | «تم نسخ خطة التنفيذ الكاملة» |
| Copy All | نسخ الكل | session + cover, ordered | «تم نسخ كل البرومبتات» |

**Clipboard confirmation:** every successful copy shows a 2-second success toast; a failed copy shows a blocking error toast with retry. Every multi-prompt copy prepends the banner: «كل برومبت رقمه طلب صورة واحدة — لا تدمجها» (each numbered prompt is one image request — never combine).

---

## 12. Button State Machine

Every button resolves to exactly one of eight states, computed deterministically from session state. No button is ever ambiguously present-but-dead without a reason.

| State | Arabic | Meaning | Visual/behavior rule |
|---|---|---|---|
| Hidden | مخفي | not applicable to current mode/screen | removed from layout (rare; reserved for mode filtering, §1) |
| Visible | ظاهر | shown, resting | default |
| Disabled | معطّل | shown but not actionable + tooltip reason | never silently dead (§24) |
| Enabled | مفعّل | actionable | primary/secondary styling |
| Loading | قيد التحميل | fetching prerequisites | inline skeleton |
| Busy | مشغول | its action is running | disabled + progress; other reads allowed |
| Blocked | محظور | a blocking rule prevents it | red tooltip with `RULE_*`/`PROMPT_*` + Arabic message |
| Completed | مكتمل | its action succeeded | check state; may offer redo |

Reference button contracts:

| Button | Enabled when | Blocked when | Busy when |
|---|---|---|---|
| توليد البرومبتات (Generate Prompts) | Validation passed (RE §14) | any blocking failure exists | composing prompt text |
| نسخ B (Copy B) | source A generated + PNG present (PE §6) | missing A/PNG/stale | — |
| نسخ الغلاف (Copy Cover) | `allOutputAReady === true` (RE §8) | not all A ready / cover-uses-B | composing cover prompt |
| تصدير (Export) | ≥1 generated artifact | none available | building TXT/JSON/ZIP |
| حفظ (Save) | dirty state | — | writing snapshot |
| التحقق (Validate) | session editable | — | running validators |

The **Generate button always exists and is always discoverable** (never missing — §24). When not usable it is `Blocked`/`Disabled` with a reason, not hidden.

---

## 13. Application State Machine

UI application states (a superset view mapped onto `SessionStatus`, DM §2.1):

```
Idle ──create/open──▶ Editing
Editing ──plan──▶ Planning ──assembled──▶ Validating
Validating ──fail──▶ Editing (Blocked banner)
Validating ──pass──▶ Ready
Ready ──generate prompts──▶ Generating
Generating ──pause──▶ Paused ──resume──▶ Generating
Generating ──all prompts composed──▶ Completed
Completed ──export──▶ Exporting ──done──▶ Finished
Finished ──archive──▶ Archived
Any ──reset (confirm)──▶ Idle (working state cleared; saved projects intact)
Archived ──reopen──▶ Editing (forks a version, DM §6.1)
```

Mapping to `SessionStatus`: Idle↔(no active session), Editing↔`Draft`, Validating↔`Validating`/`Blocked`, Ready/Generating/Paused/Completed↔`Generating`, cover phase↔`CoverBuild`, Ready(generated)↔`Ready`, Exporting/Finished↔`Exported`. Every transition is user-initiated or an engine-completion event (DM §3.19 events); none is a hidden auto-advance except deterministic engine completions (planning finished, validation finished).

---

## 14. Dialogs

All modal, RTL, with a clear primary (destructive actions are never the default focus).

| Dialog | Arabic | Trigger | Primary / Secondary |
|---|---|---|---|
| Reset | إعادة تعيين | Reset working state | «إعادة تعيين» / «إلغاء»; warns saved projects are untouched (§13 PRD) |
| Clear | مسح | clear a field/section | confirm |
| Delete | حذف | delete project/scene/group | «حذف» / «إلغاء» |
| Overwrite | استبدال بالحفظ | Save over existing | confirm |
| Replace | استبدال | Replace Scene / product | confirm |
| Import | استيراد | load JSON/project | file picker + schema-version check (DM §16) |
| Export | تصدير | choose format/scope | TXT/JSON/ZIP |
| Unsaved changes | تغييرات غير محفوظة | navigating away dirty | «حفظ» / «تجاهل» / «إلغاء» |
| Missing PNG | ملف PNG مفقود | Output B needs artwork | «رفع PNG» ; explains `PROMPT_PNG_001`/`RULE_PRV_001` |
| Missing Output A | صورة البيع (A) مفقودة | Output B without source | «توليد A أولاً» ; `PROMPT_SRC_001` |
| Version mismatch | اختلاف الإصدار | project schema older/newer (DM §16) | «ترقية» (migrate) / «إلغاء»; refuses to open newer-than-app (DM §10.2) |

---

## 15. Notification System

| Type | Arabic | Use | Dismissal |
|---|---|---|---|
| Toast | إشعار | transient confirmations (copy, save) | auto 2s |
| Warning | تحذير | non-blocking advisories (near-threshold print area, artwork aspect) — never mutates selection (RE §13) | manual |
| Blocking Error | خطأ مانع | halts progress; shows `RULE_*`/`PROMPT_*` + Arabic message | manual + recovery action |
| Information | معلومة | tips, gate explanations | manual |
| Progress | تقدّم | planning/validation/export progress | auto on completion |
| Success | نجاح | completed generation/export | auto |

Ordering: blocking errors are shown first and stacked above warnings; print-area blocking always tops the stack (RE §2).

---

## 16. Keyboard Shortcuts

RTL-aware; all discoverable in Help.

| Shortcut | Arabic action | Behavior |
|---|---|---|
| Ctrl+C | نسخ | Copy focused prompt (A or B) — one image |
| Ctrl+Shift+C | نسخ خطة التنفيذ | Copy Execution Plan (PE §17) |
| Ctrl+S | حفظ | Manual Save (snapshot) |
| Ctrl+O | فتح | Open project |
| Ctrl+Z | تراجع | Undo (version step back, DM §3.14) |
| Ctrl+Y | إعادة | Redo |
| Delete | حذف | Delete selected scene/group (confirm) |
| Enter | تأكيد | Confirm dialog / commit inline edit |
| Escape | إلغاء | Cancel dialog / exit inline edit |
| Space | توسيع/طي | Expand/collapse focused scene |
| F2 | إعادة تسمية | Rename project/session/group |
| F5 | إعادة التحقق | Re-run Validation |

No shortcut ever triggers image generation or combines A+B (§0.3).

---

## 17. Responsive Behavior

RTL layouts scale by breakpoint; content density increases, controls never hide.

| Target | Layout |
|---|---|
| Laptop (≈1366) | single working column + collapsible right inspector; scene list virtualized |
| Desktop (≈1920) | two-pane: scene list + inspector; persistent copy toolbar |
| Ultra-Wide (≈2560+) | three-pane: navigation + scene list + Prompt Preview side-by-side |
| 4K (≈3840) | three-pane + docked Execution Center; larger swatches/previews, same information architecture |

Rule: wider screens reveal *more panes*, never *more features* — every control exists at every size (accessible via menus on smaller screens), preventing "hidden controls" (§24).

---

## 18. Accessibility & Localization

- **Keyboard only:** every action reachable without a pointer (reorder via Move, §5; shortcuts §16).
- **Focus order:** logical RTL order (right→left, top→bottom); visible focus ring; modal focus trap.
- **Screen reader:** Arabic ARIA labels/roles for every control and state; live regions announce toasts, validation results, and execution-state changes.
- **Contrast:** meets WCAG AA; blocking errors and print-area warnings use non-color-only indicators (icon + text).
- **Localization:** **Arabic only** UI, fully RTL. Numerals, hashes, and the English prompt previews render LTR within RTL containers. **Prompt output is English only** (PE §20) and clearly labeled «نص البرومبت بالإنجليزية».
- **RTL/LTR mixing:** bidi-isolation around English tokens (product names, checksums) to prevent reordering artifacts.

---

## 19. Performance UX

- **Loading skeletons** for lists, prompt previews, and metadata (§3 common state).
- **Lazy loading:** scene rows, prompt text, and rule traces load on demand; season libraries load per active season (SE §3; ARCH §10.3).
- **Large projects:** virtualized scene list handles 50 scenes / 100 prompts without layout jank; Execution Center paginates by phase.
- **Search & filtering:** filter scenes by product/color/view/hero-support/state; search prompts by number. All deterministic, index-backed.
- **Derived-value caching:** `sceneFingerprint`, `promptChecksum`, `allOutputAReady` are read from cached fields (DM §22), so the UI never recomputes heavy state on scroll.

---

## 20. Error Recovery

| Scenario | Arabic surface | Recovery |
|---|---|---|
| Lost project | مشروع مفقود | offer latest autosave / version snapshot (DM §3.14) |
| Invalid data | بيانات غير صالحة | isolate the offending entity; block only the affected scene, keep the rest usable |
| Corrupted project | مشروع تالف | attempt migration; if impossible, restore last valid `VersionSnapshot` |
| Missing libraries | مكتبات مفقودة | name the missing season/product library; block dependent scenes with a clear reason; other scenes proceed |
| Version mismatch | اختلاف الإصدار | migrate forward (DM §16); refuse to open newer-than-app rather than corrupt |
| Recover session | استعادة الجلسة | autosave restore prompt on next open (§21) |

No recovery path silently discards user work; every path names the cause and the exact next action.

---

## 21. Project Manager

| Action | Arabic | Behavior |
|---|---|---|
| Save | حفظ | writes a `VersionSnapshot` (`reason='manual_save'`, DM §3.14) |
| Load | فتح | opens a project; runs migration if needed (DM §16) |
| Save As | حفظ باسم | new project id, copies state |
| Duplicate | إنشاء نسخة | duplicates project (`reason='duplicate'`) |
| Rename | إعادة تسمية | updates `name`; no fingerprint change (SessionFingerprint excludes names, DM §3.18) |
| Recent Projects | المشاريع الأخيرة | `recentProjectsMeta` list |
| Project History | سجل المشروع | browse `versionHistory` (DM §3.14); restore forks a version |
| Auto Save | حفظ تلقائي | periodic snapshot per Settings (§22); non-destructive |
| Manual Save | حفظ يدوي | Ctrl+S; explicit snapshot |

Save-state correctness: the UI shows a persistent "dirty/clean" indicator tied to `updatedAt`/`sceneVersion`; a save is confirmed only after the snapshot is written (prevents "incorrect save state", §24).

---

## 22. Settings

| Setting | Arabic | Options |
|---|---|---|
| Language | اللغة | العربية (fixed UI language; interface is Arabic-only) |
| Theme | المظهر | فاتح/داكن (light/dark) |
| Prompt Style | نمط البرومبت | prompt template version selection (`templateVersion`, PE §19) — affects checksum, documented |
| Autosave | الحفظ التلقائي | interval / off |
| Default Products | المنتجات الافتراضية | seed `productIds` for new sessions |
| Default Colors | الألوان الافتراضية | seed `colorSelection` |
| Default Groups | المجموعات الافتراضية | default `groupBy` |
| Default Export | التصدير الافتراضي | default `ExportScope`/`ExportFormat` |

Changing "Prompt Style" or defaults never mutates existing sessions retroactively; it affects new composition only (determinism, PE §20).

---

## 23. Complete User Journey

```
افتح التطبيق (Open App)
   → الرئيسية: جلسة جديدة / استئناف
      ↓
أنشئ جلسة (Create Session)
   → اختر الوضع (Mode) + الاسم
      ↓
اضبط الجلسة (Configure Session)
   → الموسم → المنتجات → الألوان (+قفل) → الجمهور → عدد المشاهد → المجموعات
   (chips live-validate; Kids-product & color-lock guards active)
      ↓
خطّط (Plan)
   → Scene Engine assembles deterministic scenes; hero/support; dedup; diversity (SE §2)
   → Scene Planner for reorder/replace/lock (§5)
      ↓
تحقّق (Validate)  ← blocking gate (RE §14); must pass
      ↓
ولّد البرومبتات (Generate Prompts)
   → Prompt Engine composes English A/B prompt TEXT only (PE §2); nothing auto-generates images
      ↓
انسخ (Copy)
   → Copy A / B / Pair / Group / Execution Plan (§11); banners enforce one-image-per-request
      ↓
ولّد الصور (Generate Images — user action, external)
   → Phase 1: run each {n}A → save each Sale Image; mark done in Execution Center (§10)
   → Phase 2: attach {n}A + PNG, run each {n}B → save each Preview
   (missing A/PNG ⇒ blocked with reason; never auto-invented, PE §6/§7)
      ↓
ولّد الغلاف (Generate Cover)
   → unlocks only when allOutputAReady (RE §8); Copy Cover (Sale Images A only, PE §18)
      ↓
صدّر (Export)
   → TXT/JSON/ZIP + Copy All / Complete Execution Plan (§12 PRD)
      ↓
أرشف (Archive)
   → snapshot to Project History; session archived, reopenable as a new version (DM §3.14/§6.1)
```

Every arrow is an explicit, labeled, deterministic user action or an engine-completion event — never a silent auto-jump.

---

## 24. Preventing Every Known Problem

Explicit UI guarantees against past failures:

| Past problem | Prevention |
|---|---|
| Generate button missing | The Generate button **always exists** and is discoverable at every breakpoint (§12/§17); when unusable it is `Blocked`/`Disabled` **with a visible reason**, never hidden. |
| Copy button not working | Copy is a first-class action with success/failure toasts (§11); a failed copy shows a retry, never a silent no-op. |
| Automatic generation | Image generation is **never automatic** (§0.2/§23); the app composes/copies text only; the user runs each image explicitly in Execution Center. |
| Wrong color allocation | Deterministic round-robin over the **locked** selected colors (SE §14; §7); garment vs decor domains separated (RE §6); violations blocked (`RULE_PAL_002`). |
| Broken grouping | Group invariants enforced (all members share `groupBy`, DM §3.10); illegal moves blocked (§8). |
| Broken numbering | `{n}A/{n}B` derives only from `sceneOrder`; stable across save/load/copy/export/regeneration (PE §14; §5). |
| Invalid output counts | One Scene → exactly one A + one B (PE §3/§17); `totalScenes`/`allOutputAReady` shown; feasibility precheck blocks impossible counts (`RULE_CNT_001`). |
| Hidden controls | Wider screens add panes, not features; smaller screens keep every control in menus (§17). |
| Duplicated scenes | Hard uniqueness on the four-part signature (SE §8); duplicate creation blocked (`RULE_DUP_001`) with a clear message. |
| Incorrect save state | Persistent dirty/clean indicator tied to `sceneVersion`/`updatedAt`; save confirmed only after snapshot write (§21). |
| Unexpected resets | Reset/Clear/Delete always confirm (§14); autosave protects work; saved projects untouched by working-state reset (§13). |
| Invalid drag & drop | Drops allowed only into valid positions; invalid drops snap back; keyboard Move alternative (§5). |
| Missing validations | The Validation gate is mandatory before generation (§4/§13); blocking failures list code + Arabic message + field (RE §15). |
| Cover uses previews | Cover is structurally Sale-Images-A-only (DM §3.9); B reference impossible/blocked (`RULE_COV_001`, §9). |
| Missing PNG / source A | Output B is blocked with a specific dialog and recovery action, never auto-invented or blank-replaced (§6/§14; PE §6/§7). |
| Stale previews | `outputB.isStale` surfaced; Execution Center offers regenerate (§10). |
| Silent language/RTL bugs | Arabic-only RTL with bidi isolation for English tokens; prompts clearly labeled English (§18). |

---

## 25. Future Extensibility

The UI is **data-driven and mode-filtered**, so new capability appears without redesign:

- **New product/season/pose/library** → arrives as a data manifest (SE §20); it shows up automatically in Product/Color/Scene planners as new selectable items — no screen changes.
- **New prompt module / template version** → surfaces in Prompt Preview versions and Settings "Prompt Style" (§22); composition and checksums update deterministically (PE §19).
- **New rule domain / rule** → new validation chips and rule-trace rows appear automatically from the Rule Engine output (RE §15); no bespoke UI.
- **New export format / scope** → registers into Export Center and the copy matrix (§11) as a new option.
- **New engine event** (DM §3.19) → the notification/progress system renders it generically.
- **New mode capability** → exposed by adjusting the mode view-filter (§1), not by forking the data or screens.

Because every screen renders from the persisted model + engine outputs (not hardcoded content), the content universe expands indefinitely (§6/§15 PRD) while the interface remains stable.

---

## 26. Compatibility Appendix

### 26.1 PRD (`01_PRD.md`)
- [x] Workflow Project→Session→Products→Scenes→Prompts→Cover→Export mirrored (§3; §4/§23 here).
- [x] Save/Load/Duplicate/Recent/Reset/Version History (§13; §21 here). Export TXT/JSON/ZIP + copy scopes (§12; §11 here).
- [x] Validation halts generation (§14; §4/§13 here). Print-area supremacy surfaced (§11; §0/§15 here).

### 26.2 Architecture (`02_ARCHITECTURE.md`)
- [x] Screen hierarchy follows ARCH §7; sequential gating; library-manager expandability (§2/§25 here).
- [x] Deterministic state machine; engine-completion events drive transitions (ARCH §1.2/§6; §13 here).

### 26.3 Data Model (`03_DATA_MODELS_FINAL.md`)
- [x] UI reads `SessionStatus`, `GenerationProgress.allOutputAReady`, `ValidationResult`, `PromptMetadata`, `SessionFingerprint`, `VersionSnapshot` exactly (§9/§12/§13/§21 here).
- [x] Derived `PromptExecutionState` used read-only; no model change (§10; PE §6).

### 26.4 Rule Engine (`04_RULE_ENGINE_REVISED.md`)
- [x] Blocking vs warning semantics; Arabic messages; rule trace shown; precedence ladder respected (RE §13/§14/§15; §4/§15 here).

### 26.5 Scene Engine (`05_SCENE_ENGINE.md`)
- [x] Scene Planner surfaces hero/support, dedup, diversity, deterministic order (SE §7–§10; §5 here).
- [x] Color allocation + group numbering from SE §14/§18 (§7/§8 here).

### 26.6 Prompt Engine (`06_PROMPT_ENGINE.md`)
- [x] One prompt = one image enforced across copy/execution; A/B separate; B needs A+PNG (PE §3/§6/§15; §10/§11/§24 here).
- [x] Cover from Sale Images A only; checksums/versions shown; English prompt output within Arabic UI (PE §18/§19/§20; §9/§18 here).

---

*End of UI & Workflow Engine specification. Sourced only from `01_PRD.md` v1.0, `02_ARCHITECTURE.md`, `03_DATA_MODELS_FINAL.md`, `04_RULE_ENGINE_REVISED.md`, `05_SCENE_ENGINE.md`, and `06_PROMPT_ENGINE.md`. Operational specification only — no application code, React, HTML, or CSS. Deterministic throughout; Arabic-only RTL interface; English-only prompt output; image generation is never automatic; one prompt = one image; print-area rules always highest priority.*
