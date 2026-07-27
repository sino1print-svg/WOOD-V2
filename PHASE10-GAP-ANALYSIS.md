# PHASE10-GAP-ANALYSIS

## Mockup Photoshoot Director — Phase 10 Gap Analysis

**الحالة:** تقرير فحص فقط — جاهز للاعتماد — لم يبدأ تنفيذ Phase 10  
**الحزمة المفحوصة:** `mockup-photoshoot-director-phase9-final-completion.zip`  
**خط الأساس المقبول:** Phase 09 — Scene Engine مكتملة وفق إفادة المستخدم وحزمة التسليم  
**حد التغيير الحالي:** هذا التقرير وحده؛ لم تُعدّل الشيفرة أو `docs/spec/`

---

## 1. الخلاصة التنفيذية

القرار المقترح للاعتماد هو أن **Phase 10 تعني Export Engine**، وليس Orchestrator:

- `docs/spec/12_IMPLEMENTATION_GUIDE.md`، قسم **Engine Build Order**، يسمّي
  `10. Export Engine` ثم `11. Orchestrator`.
- قسم **Integration Order** يسمّي `I7 Export` قبل `I8 Orchestrator`.
- قسم **Export Engine Build Order** يحدد ترتيب التنفيذ الملزم من Scope Resolution إلى Events.
- الملف `docs/spec/10_APP_WORKFLOW.md` هو مواصفة Orchestrator، لكن رقم اسم ملف المواصفة لا يغيّر
  ترتيب المرحلة التنفيذي الواضح في دليل التنفيذ.

الموجود حاليًا من Phase 10 هو أساس تعاقدي محدود فقط: أنواع ونطاقات وصيغ، عقد قديم ضيق، تعريف
`ExportManifest` ومخططه، سجل أخطاء `EXPORT_*`، وخريطة صيغ تشغيلية. أمّا محرك التصدير،
الـformatters، ZIP، النسخ الاحتياطي، الاستعادة، Prompt Pack، أحداث التصدير، واختبارات Phase 10
فغير منفذة.

النتيجة: **Phase 10 لم تبدأ فعليًا**. يمكن تنفيذها، لكن يلزم اعتماد القرارات الواردة في القسم 9 قبل
كتابة الشيفرة، لأن المواصفات تحتوي على نقاط متعارضة أو غير قابلة للتطبيق حرفيًا من دون سياسة
تنفيذ معلنة، ولأن بعض البيانات التي يقرأها Export غير مكتملة في المراحل السابقة.

---

## 2. نطاق الفحص وسلامة الحزمة

### 2.1 تحقق الحزمة

| الفحص                               |                                                            النتيجة |
| ----------------------------------- | -----------------------------------------------------------------: |
| SHA-256 للحزمة                      | `39c227a5afaf373e7a410e79c2981f55b5e4f3d47200de53db7411455769acd5` |
| التطابق مع ملف `.sha256` المرفق     |                                                              مطابق |
| `unzip -t`                          |                                                     سليم؛ لا أخطاء |
| عناصر ZIP، بما فيها المجلدات        |                                                                393 |
| الملفات العادية بعد الفك            |                                                                323 |
| الملفات المدرجة في `SHA256SUMS.txt` |                                                                322 |
| نتيجة فحص جميع checksums الداخلية   |                                                 322 سليمة، 0 تالفة |
| وجود `.git` داخل الحزمة             |                            غير موجود؛ الحزمة Git-ready وليست clone |
| وجود `node_modules`                 |                            غير موجود، كما هو متوقع من حزمة التسليم |

`SHA256SUMS.txt` يستثني نفسه؛ لذلك يحتوي 322 سجلًا مقابل 323 ملفًا فعليًا.

### 2.2 حجم المستودع المفحوص

| المجموعة                                         |  العدد |
| ------------------------------------------------ | -----: |
| ملفات المواصفات في `docs/spec/`                  |     12 |
| ملفات المصدر TypeScript/TSX                      |    120 |
| جميع ملفات `src/`                                |    126 |
| ملفات الاختبار TypeScript/TSX                    |    111 |
| جميع ملفات `test/`                               |    114 |
| مخططات JSON                                      |     12 |
| إجمالي أسطر TypeScript/TSX في المصدر والاختبارات | 31,565 |

### 2.3 المواصفات المقروءة كاملة

تمت قراءة الملفات الاثني عشر كاملة قبل إعداد هذا التقرير:

1. `01_PRD.md`
2. `02_ARCHITECTURE.md`
3. `03_DATA_MODELS_FINAL.md`
4. `04_RULE_ENGINE_REVISED.md`
5. `05_SCENE_ENGINE.md`
6. `06_PROMPT_ENGINE.md`
7. `07_UI_ENGINE.md`
8. `08_COVER_ENGINE.md`
9. `09_EXPORT_ENGINE.md`
10. `10_APP_WORKFLOW.md`
11. `11_TEST_PLAN.md`
12. `12_IMPLEMENTATION_GUIDE.md`

لم يُعدّل أي ملف منها. سلامتها مؤكدة أيضًا عبر checksums الحزمة الداخلية.

### 2.4 ما لم يُشغّل في مرحلة الفحص

لم تُشغّل أوامر npm التالية عمدًا، لأن المستخدم اشترط إنهاء التقرير واعتماده قبل التنفيذ، ولأن
`npm ci` عملية تغيّر بيئة العمل المحلية:

- `npm ci`
- `npm audit`
- `npm audit --omit=dev`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run test`
- `npm run verify:determinism`
- `npm run build`
- `npm run verify`
- `npm run verify:full`

الحالة الخضراء لهذه البوابات هي **خط أساس من حزمة Phase 09 ومن إفادة المستخدم**، وليست نتيجة
إعادة تشغيل في جلسة تحليل الفجوات. يسجل `MANIFEST.json` و
`PHASE9-FINAL-COMPLETION-REPORT.md` نجاح 1869/1869 اختبارًا ونجاح `verify:full` بخروج 0.

---

## 3. ما تم تنفيذه بالفعل

هذا جدول وجود وفحص ساكن، وليس إعادة اعتماد للمراحل السابقة:

| المكوّن                                    | الحالة الحالية           | الدليل                                                                |
| ------------------------------------------ | ------------------------ | --------------------------------------------------------------------- |
| Domain model / IDs / enums / schemas       | موجود                    | `src/shared/domain-model/`, `schemas/`                                |
| Error registry ثنائي اللغة                 | موجود                    | `src/shared/errors/`                                                  |
| Persistence / assets / recovery / versions | منفذ وله اختبارات        | `src/persistence/`, `test/persistence/`                               |
| Rule Engine                                | منفذ وله اختبارات        | `src/engines/rule-engine/`                                            |
| Palette Engine                             | منفذ وله اختبارات        | `src/engines/palette-engine/`                                         |
| Print-Area Engine                          | منفذ وله اختبارات        | `src/engines/print-area-engine/`                                      |
| Prompt Engine — A/B                        | منفذ وله اختبارات        | `src/engines/prompt-engine/`                                          |
| UI state/controller layer                  | منفذ جزئيًا وله اختبارات | `src/ui-engine/`                                                      |
| Cover Engine                               | منفذ وله اختبارات        | `src/engines/cover-engine/`                                           |
| Scene Engine                               | منفذ ومعتمد في Phase 09  | `src/engines/scene-engine/`                                           |
| Export domain enum/scope                   | موجود                    | `ExportScope`, `ExportFormat` في `enums.ts`                           |
| Export manifest type                       | موجود                    | `src/shared/domain-model/export-manifest.ts`                          |
| Export manifest schema wrapper/definition  | موجود جزئيًا             | `schemas/export-manifest.schema.json`, تعريفه في `domain.schema.json` |
| Export error catalog                       | موجود، 24 كودًا          | `src/shared/errors/registry.ts`                                       |
| Operational delivery types                 | موجودة                   | `src/shared/contracts/export-refinements.ts`                          |
| Operational-to-persisted format mapping    | منفذة                    | `src/export/format-mapping.ts`                                        |
| اختبار Export الحالي                       | 3 حالات لخريطة الصيغ فقط | `test/export/format-mapping.test.ts`                                  |

### 3.1 الأساس القابل لإعادة الاستخدام لاحقًا

- `APP_CONFIG.limits.maxPathSegment = 60` و`maxPathLength = 200` يطابقان حدود EX §12.
- `src/persistence/shared/canonical-json.ts` يملك canonical JSON وUTF-8 وSHA-256 وsafe parsing.
- `src/persistence/shared/migrations.ts` يملك سلسلة migration الحالية.
- `src/persistence/version-history/` يملك استعادة VersionSnapshot آمنة.
- `src/ui-engine/copy.ts` يملك port بسيطًا للحافظة ونسخ النص كما هو.
- اختبارات architecture الحالية تعرف Export كـterminal reader وتمنع استيراده محركات أخرى.

هذه الأجزاء لا تكفي بذاتها:

- Export لا يجوز له استيراد Persistence أو UI مباشرة.
- canonical JSON الحالي يعيد `PersistenceResult` وأكواد Persistence؛ لذلك لا يمكن استخدامه كواجهة
  Export عامة كما هو.
- clipboard الحالي لا يطبق banner أو fallback أو أكواد `EXPORT_*`.
- استعادة VersionSnapshot الحالية ليست استعادة Backup وفق EX §15.

---

## 4. نطاق Phase 10 الصحيح

### 4.1 داخل النطاق

بحسب `09_EXPORT_ENGINE.md` و`12_IMPLEMENTATION_GUIDE.md` §16:

1. Scope resolution لكل النطاقات التشغيلية.
2. Validation before export، مع blocking وpartial export.
3. Stable ordering وA-before-B وحفظ numbering/linkage.
4. Clipboard/TXT/Markdown/JSON formatters.
5. UTF-8/LF/canonical JSON وSHA-256.
6. File naming وASCII slug وWindows safety وcollision policy.
7. ZIP حتمي: ترتيب entries، fixed epoch، fixed compression، no empty folders.
8. `ExportManifest` و`checksums.sha256`.
9. Clipboard delivery/fallback عبر ports صريحة.
10. Full/session/version backup packaging.
11. Restore parsing، validation، preview، merge/replace plan، والتطبيق المعاملي في طبقة Persistence.
12. Prompt Pack.
13. Export/backup/restore/clipboard events.
14. Cancellation بلا ملف جزئي.
15. Security: no runtime leakage، no secrets/paths/asset bytes، traversal/bomb limits.
16. Performance ودعم 50 scene / 100 prompt.
17. اختبارات QA T146–T175، مع تغطية مصفوفة EX §25 T01–T84.

### 4.2 خارج النطاق

لن يبدأ ضمن Phase 10:

- Orchestrator في `src/app/orchestrator/`.
- Validation Engine العام في `src/engines/validation-engine/`.
- standalone Dedup Engine.
- Export Center أو ربط أزرار UI.
- إعادة بناء UI screens/components/view-state.
- توليد بيانات products/seasons/palettes/rules أو ملء `src/libraries/`.
- Query Engine أو Cache Engine؛ لا توجد مواصفة لهما في `docs/spec/`.
- rendering أو إدراج rendered images.
- النشر إلى marketplace أو cloud backup أو direct external-tool integration.
- أي extension معلّم future-only في EX §27.
- Windows desktop packaging أو installer.

Phase 10 ستنتج محركًا وواجهات قابلة للربط. الربط الكامل بالـUI ومسار التطبيق يبقى للـOrchestrator
والمرحلة اللاحقة.

---

## 5. ملفات Phase 10 الموجودة

### 5.1 ملفات المصدر والعقود

| الملف                                        | الموجود حاليًا                                   | تقييم الاكتمال                                         |
| -------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `src/engines/export-engine/index.ts`         | تعليق تأجيل و`export {}`                         | فارغ صراحةً                                            |
| `src/export/index.ts`                        | تعليق تأجيل و`export {}`                         | فارغ صراحةً                                            |
| `src/export/format-mapping.ts`               | خريطة 5 صيغ إلى 3 صيغ persisted                  | مكتمل لهذا الغرض فقط                                   |
| `src/shared/contracts/export-refinements.ts` | `clipboard` و`markdown` كأنواع تشغيلية           | موجود                                                  |
| `src/shared/contracts/engine-contracts.ts`   | `ExportEngineContract` القديم                    | موجود لكنه أضيق من المواصفة                            |
| `src/shared/domain-model/export-manifest.ts` | type للـmanifest                                 | موجود، يحتاج توسيعًا متوافقًا أو نتيجة تشغيلية مرافقة  |
| `src/shared/domain-model/enums.ts`           | `ExportScope` و`ExportFormat` و`EngineId.Export` | موجود                                                  |
| `src/shared/domain-model/events.ts`          | أحداث حتى `ProjectSaved`                         | أحداث Export غير موجودة                                |
| `src/shared/errors/registry.ts`              | 24 كود `EXPORT_*`                                | موجود مع تعارض موثق في §9                              |
| `src/config/app-config.ts`                   | path limits وdefault scope/format                | ناقص حدود ZIP/import والـfeature flags                 |
| `schemas/export-manifest.schema.json`        | wrapper إلى `domain.schema.json`                 | wrapper صحيح                                           |
| `schemas/domain.schema.json`                 | تعريف أولي لـ`ExportManifest`                    | غير كافٍ لعلاقات size/checksum/format/security الكاملة |

### 5.2 ملفات الاختبار

| الملف/المجلد                                | الحالة                |
| ------------------------------------------- | --------------------- |
| `test/export/format-mapping.test.ts`        | موجود؛ 3 اختبارات فقط |
| `test/export-engine/`                       | غير موجود             |
| golden masters لملفات TXT/MD/JSON/ZIP       | غير موجودة            |
| fixtures كاملة لمشروع/جلسة Export           | غير موجودة            |
| tests للـscope/validation/ordering          | غير موجودة            |
| tests للـZIP determinism                    | غير موجودة            |
| tests للـbackup/restore                     | غير موجودة            |
| tests للـtraversal/bomb/cancellation/stress | غير موجودة            |

### 5.3 اعتماديات الحزمة

لا توجد مكتبة ZIP في `package.json` أو `package-lock.json`. الاعتماديات التشغيلية الحالية هي:

- `ajv`
- `react`
- `react-dom`

اختيار تنفيذ ZIP يجب أن يكون حقيقيًا، حتميًا، browser-compatible، مثبت الإصدار، وقابلًا لتقييد
الاستهلاك عند import. لن يُضاف dependency قبل اعتماد التقرير، وأي dependency يضاف لاحقًا يجب أن
يمر عبر `npm audit` و`npm audit --omit=dev` من دون `--force`.

---

## 6. الملفات والمكوّنات الناقصة

الأسماء أدناه هي تقسيم تنفيذي مقترح، وليست أسماء مفروضة حرفيًا في المواصفات.

### 6.1 نواة Export Engine

| الوحدة المقترحة                      | المسؤولية                                           |
| ------------------------------------ | --------------------------------------------------- |
| `src/engines/export-engine/types.ts` | input/result/artifact/port contracts                |
| `scope.ts`                           | تحويل operational scope إلى artifact set            |
| `validation.ts`                      | export-specific validation وpartial eligibility     |
| `selection.ts`                       | allowlisted read-only artifact projection           |
| `ordering.ts`                        | sessions/groups/scenes/A/B/cover canonical ordering |
| `numbering.ts`                       | `{n}A/{n}B` وgroup numbering map                    |
| `failures.ts`                        | بناء `ValidationFailure` من سجل الأخطاء             |
| `engine.ts`                          | staged pure coordinator بلا UI/Persistence imports  |
| `events.ts`                          | event contracts/builders بلا prompt bytes           |
| `index.ts`                           | public exports المتوافقة                            |

### 6.2 Formatters وPackaging

| الوحدة المقترحة      | المسؤولية                             |
| -------------------- | ------------------------------------- |
| `src/export/utf8.ts` | UTF-8 no BOM وLF helpers              |
| `canonical-json.ts`  | canonical/readable JSON بسياسة Export |
| `hash.ts`            | SHA-256 على bytes والنص               |
| `txt.ts`             | EX §8                                 |
| `markdown.ts`        | EX §9                                 |
| `json.ts`            | EX §10 مع allowlist                   |
| `filenames.ts`       | EX §12 وWindows safety                |
| `manifest.ts`        | EX §13                                |
| `zip.ts`             | EX §11 وfixed epoch/order             |
| `clipboard.ts`       | payload/banner/delivery/fallback      |
| `backup.ts`          | full/session/version packages         |
| `restore.ts`         | decode/verify/preview/plan            |
| `prompt-pack.ts`     | EX §16                                |
| `index.ts`           | public formatter/package surface      |

### 6.3 تكامل Persistence الضروري فقط

يلزم مسار Persistence ضيق، لأن Export Engine read-only ولا يجوز أن يطبّق mutation:

- عقد `RestorePlan` ناتج من Export validation.
- وظيفة Persistence لإجراء Merge/Replace transactionally بعد confirmation.
- rollback قبل commit عند أي فشل.
- migration عبر السلسلة الحالية.
- نتيجة applied changes قابلة لحدث `RestoreCompleted`.

المسار المقترح هو وحدة additive تحت `src/persistence/backup-restore/` مع export من
`src/persistence/index.ts`. Export Engine لن يستوردها؛ Orchestrator المستقبلي هو الذي يجمع الطرفين.

### 6.4 العقود والمخططات والأحداث

يلزم تحديث additive، مع الحفاظ على كل API قائم:

- إضافة عقد input/result حديث، مع إبقاء `ExportEngineContract` الحالي صالحًا.
- operational scope selectors typed بدل `scopeDetail` غير المقيد وحده.
- artifact bytes وmedia type وfilename/checksum في نتيجة التشغيل.
- delivery ports للحافظة والتنزيل وprogress/cancellation.
- أحداث Export/Backup/Restore/Clipboard.
- تشديد schema لقيم `fileSizes` و`checksums` والمسارات.
- حدود config لـJSON depth/bytes وZIP entries/uncompressed bytes/compression ratio.
- عدم توسيع `ExportFormat` persisted بـclipboard/markdown.

### 6.5 الاختبارات الناقصة

يلزم إنشاء مجموعة اختبارات Phase 10 تشمل:

- contract/architecture.
- scope resolution.
- blocking/partial validation.
- stable ordering/numbering/linkage.
- exact prompt bytes.
- TXT/Markdown/JSON golden bytes.
- checksum semantics.
- filename/Unicode/Windows cases.
- manifest completeness.
- deterministic ZIP/fixed epoch/entry order.
- clipboard success/denial/fallback.
- backup/restore preview/migration/transaction/rollback.
- Prompt Pack.
- events/cancellation.
- prototype pollution/runtime leakage/secrets/path traversal/decompression limits.
- 50 scenes / 100 prompts وlarge version history.
- double-run byte identity.

---

## 7. ما يعتمد على Phase 10 وما تعتمد عليه

### 7.1 اعتماديات تدخل إلى Phase 10

| الاعتمادية                                     | الحالة                                                    | الأثر                                                                           |
| ---------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Project`/sessions/scenes/outputs/groups/cover | موجودة كـdomain state                                     | المصدر الأساسي                                                                  |
| Product/season/color names                     | الأنواع موجودة؛ registries الإنتاجية فارغة                | يجب حقن manifests read-only                                                     |
| Prompt A/B text + metadata                     | منفذ                                                      | يصدّر byte-for-byte                                                             |
| Group prompt text                              | الحقل موجود لكن Scene يضعه `null` وPrompt لا يكتبه حاليًا | Prompt Pack/Group plan قد يصبح partial                                          |
| Complete Execution Plan                        | غير موجود كartifact محفوظ                                 | Export يستطيع بناء plan تنظيمي فقط من النصوص الموجودة، لا اختراع prompt content |
| ValidationResult                               | النوع موجود؛ Validation Engine فارغ                       | Export يطبق فحصه الخاص ولا يستورد Validation Engine                             |
| Cover prompt/metadata                          | موجودان عند اكتمال barrier                                | cover export ممكن                                                               |
| Artwork metadata                               | موجودة في Project                                         | bytes ممنوعة                                                                    |
| Version history/migrations                     | موجودة                                                    | أساس backup/restore                                                             |
| canonical JSON/SHA                             | موجودة داخل Persistence فقط                               | تحتاج primitive مشتركة أو تنفيذ Export معزولًا                                  |

### 7.2 مكونات تعتمد على اكتمال Phase 10

- Orchestrator stage 7 و`I8`.
- Export Center وعمليات Copy في UI.
- Generate/Export end-to-end flow.
- تنزيل TXT/MD/JSON/ZIP الفعلي.
- backup/restore من ملفات خارج التطبيق.
- full end-to-end determinism وgolden masters.
- security gates الخاصة بالـZIP/import.
- الإصدار النهائي والتغليف اللاحق.

### 7.3 مكونات لا يجوز أن يستدعيها Export

Export terminal reader:

- لا يستدعي Rule/Scene/Prompt/Cover/Validation/Persistence mutation.
- لا يستورد UI.
- لا يعيد توليد prompt.
- لا يصلح scene أو group أو cover.
- لا يحمّل artwork bytes.
- لا يستخدم وقتًا أو locale أو filesystem order داخل المسارات الحتمية.

---

## 8. سجل الـstubs والفجوات المتبقية

### 8.1 ملفات فارغة صراحةً

هناك 11 ملفًا في `src/` يعلن نصه أنه غير منفذ وينتهي بـ`export {}`:

| الملف                                    | الصلة بـPhase 10                                 |
| ---------------------------------------- | ------------------------------------------------ |
| `src/engines/export-engine/index.ts`     | داخل Phase 10 ويجب استبداله بتنفيذ كامل          |
| `src/export/index.ts`                    | داخل Phase 10 ويجب استبداله                      |
| `src/engines/validation-engine/index.ts` | خارج Phase 10؛ اعتماد downstream                 |
| `src/engines/dedup-engine/index.ts`      | خارج Phase 10؛ Scene يملك تنفيذًا داخليًا حاليًا |
| `src/app/orchestrator/index.ts`          | خارج Phase 10؛ يعتمد على Export                  |
| `src/app/commands/index.ts`              | خارج Phase 10                                    |
| `src/app/state/index.ts`                 | خارج Phase 10                                    |
| `src/app/validation-gate/index.ts`       | خارج Phase 10                                    |
| `src/ui/components/index.ts`             | خارج Phase 10                                    |
| `src/ui/screens/index.ts`                | خارج Phase 10                                    |
| `src/ui/view-state/index.ts`             | خارج Phase 10                                    |

لن تُزال الملفات الخارجة عن Phase 10 في هذه المرحلة. سيبقى وجودها موثقًا كي لا يُعلن اكتمال
التطبيق كله خطأً عند اكتمال Export.

### 8.2 فجوات بيانات وربط

- مجلدات `src/libraries/{products,seasons,palettes,rule-sets,prompt-modules}` تحتوي `.gitkeep` فقط.
- `src/ui/app-shell/AppShell.tsx` يستخدم catalog ثابتًا، وأزرار Save/Restore/Generate غير مربوطة
  بمسار الإنتاج الكامل.
- لا يوجد أي import فعلي لـExport Engine من التطبيق.
- `Group.groupPromptText` يخرج `null` من Scene، وPrompt Engine الحالي لا يطبق Group Prompt أو Complete
  Execution Plan رغم وجودهما في PE §16/§17.
- أحداث `ExportStarted` وما بعدها غير موجودة في domain event union.
- لا توجد feature flags `export.markdown` و`export.promptPack`.
- لا توجد export/import resource limits عدا حدود path.
- README ووصف `package.json` ما زالا يصفان Phase 7، بينما `MANIFEST.json` يصف Phase 9.

### 8.3 فجوات جودة واختبار

- لا يوجد implementation marker تشغيلي من نوع TODO/FIXME في محرك Phase 09 أو Phase 10 لأن Phase 10
  فارغة أصلًا؛ النصوص الموجودة هي تعليقات تأجيل صريحة.
- لا توجد type assertion فعلية `as never` في `src/`. نتيجة بحث نصية واحدة كانت العبارة الإنجليزية
  “was never”، وليست assertion.
- توجد 88 استعمالًا موروثًا لـ`as never` في 30 ملف اختبار لتمرير hostile inputs. لن يضاف أي استعمال
  جديد في Phase 10. تنظيف الاختبارات التاريخية ليس جزءًا من Export، ويحتاج قرارًا منفصلًا إن كان
  المطلوب صفرًا على مستوى المستودع كله.
- لا يوجد `Math.random` في `src/`.
- لا يوجد اختبار architecture مخصص لـExport Engine. المصفوفة تمنع engine-to-engine imports، لكنها
  لا تمنع حاليًا `src/engines/export-engine/` من استيراد Persistence مباشرةً؛ يجب سد هذا الاختبار.
- لا توجد export golden masters.

---

## 9. قرارات يلزم اعتمادها قبل التنفيذ

هذه ليست إضافات وظيفية؛ هي سياسات لازمة لحل تعارضات المواصفة مع الحفاظ على API والـDAG.

### D1 — تعريف Phase 10

**المقترح:** Phase 10 = Export Engine كاملًا، وOrchestrator مؤجل إلى Phase 11.  
**السبب:** الترتيب الصريح في Implementation Guide وIntegration Order.

### D2 — Clipboard/Markdown مقابل `ExportFormat`

المواصفة تسميهما delivery formats، بينما domain model والعقود والاختبارات المعتمدة تحصر
`ExportFormat` و`ExportManifest.exportFormats` في `txt/json/zip`.

**المقترح:** إبقاء persisted API كما هو؛ تمثل `clipboard/markdown` في
`ExportDeliveryFormat` ونتيجة delivery تشغيلية منفصلة. لا توسيع للـenum ولا كسر للمخطط.

### D3 — الكود `EXPORT_SRC_001`

EX §17 وT74 يذكرانه، لكن EX §19 — سجل الأخطاء المعياري — لا يدرجه. الاختبار الحالي يفرض أن سجل
`EXPORT_*` يساوي §19 حرفيًا بلا أكواد مخترعة.

**المقترح:** عدم اختراع `EXPORT_SRC_001`. حالة B بلا A تستخدم:

- `EXPORT_MISSINGA_001` عندما A نفسه مفقود.
- `EXPORT_LINK_001` عندما reference غير صالح.

ويُحتفظ بـ`PROMPT_SRC_001` كسبب upstream عند الحاجة إلى diagnostics.

### D4 — self-referential checksums

لا يمكن لملف `manifest.json` أو `checksums.sha256` أن يحتوي SHA-256 نهائيًا لنفس bytes التي تحتوي
ذلك الـhash؛ هذا مرجع دائري غير قابل للحل.

**المقترح:**

- manifest/checksum file يسجلان جميع **payload entries**.
- `manifest.json` و`checksums.sha256` لا يسجل كل منهما hash نفسه.
- `manifestChecksum` وarchive SHA-256 يعودان خارج الحزمة في نتيجة Export والأحداث.
- الاختبارات تثبت أن الاستثناء ذاتي فقط، ولا يوجد omission صامت لأي payload.

### D5 — Restore مع عقيدة Export read-only

EX يملك packaging/validation/preview، لكن WF يضع التطبيق المعاملي داخل Persistence عبر Orchestrator.

**المقترح:**

- Export: parse → verify → migrate-compatible preview → deterministic `RestorePlan`.
- Persistence: يطبق الخطة بعد confirmation في transaction واحدة.
- Export لا يستورد Persistence ولا يغير Project.
- Phase 10 تضيف primitive التطبيق المعاملي في Persistence، لكن لا تبدأ Orchestrator أو UI.

### D6 — group plans الناقصة upstream

Export ممنوع من اختراع `Group.groupPromptText`.

**المقترح:** يصدّر النص الموجود كما هو؛ إذا كان `null` يسجله omission/warning وفق partial export.
Prompt Pack الكامل ينجح عندما يحتوي input المعتبر على group plans. إصلاح Prompt Engine نفسه يؤجل
إلى corrective منفصل، ولا يُخبأ داخل Export.

### D7 — الوقت والحتمية

`createdAt/exportedAt` مطلوبان، وفي الوقت نفسه re-export يجب أن يكون حتميًا.

**المقترح:** الوقت input صريح من caller، وليس `Date.now()` داخل core. كل content hash و`exportId`
يستبعده. اختبار byte identity يستخدم input timestamp نفسه؛ اختبار timestamp exclusion يغيره ويتحقق
من ثبات content hashes.

### D8 — ZIP وتوقيت 1980

إنشاء `Date` عادي قد يحول fixed epoch حسب timezone، ما يكسر cross-platform determinism.

**المقترح:** كتابة/ضبط حقول ZIP/DOS مباشرة بقيم ثابتة، وترتيب paths على UTF-8 bytes. أي مكتبة
مختارة يجب أن تسمح بذلك وتكون مثبتة الإصدار وبلا اعتماديات غير مضبوطة؛ وإلا يستخدم codec محدود
ومدقق للنسق الذي ينتجه التطبيق.

### D9 — “Full backup” مقابل منع artwork bytes

المواصفة تمنع image bytes مطلقًا، لذلك لا يمكن لbackup أن يعيد artwork binary على جهاز جديد.

**المقترح:** “restorable” يعني state/metadata/version history. `pngAssetRef` المحلي وbytes لا يخرجان؛
بعد restore تُعلّم تبعيات B التي فقدت bytes بأنها blocked/missing، من دون إسقاط صامت.

### D10 — العقد القديم أضيق من التنفيذ

العقد الحالي:

`export(session, scope, formats) -> EngineResult<ExportManifest>`

لا يستطيع حمل Project كاملًا أو bytes أو delivery أو cancellation أو backup.

**المقترح:** الحفاظ عليه كواجهة توافق session/persisted-format، وإضافة عقد input/result غني باسم
جديد. لا حذف أو تغيير لتوقيع قائم، ولا إجبار المستهلكين الحاليين على تعديل فوري.

### D11 — Slug للأسماء العربية

المواصفة تطلب fixed transliteration لكنها لا تعطي جدول transliteration.

**المقترح:** لا اختراع transliteration لغوي. تُحفظ ASCII alphanumeric كما هي، ويصبح غير القابل
للتحويل `-`، وإذا فرغ slug يستخدم fallback حتميًا من stable ID/hash؛ الاسم العربي الأصلي يبقى في
metadata وREADME.

اعتماد هذا التقرير يعني اعتماد D1–D11. أي تعديل مطلوب عليها يجب أن يذكر قبل بدء Batch 10.1.

---

## 10. المخاطر

| المستوى | الخطر                                               | الأثر                               | المعالجة والبوابة                                           |
| ------- | --------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| حرج     | تغيير prompt bytes أثناء formatting                 | خرق جوهر Export                     | byte slices + golden tests T146                             |
| حرج     | تسريب `EvaluationContext`/`Resolved*`/secrets/paths | تسريب بيانات وخرق P0                | allowlist projection + hostile scans                        |
| حرج     | Restore جزئي أو overwrite صامت                      | فقد بيانات                          | immutable plan + atomic Persistence commit + rollback tests |
| حرج     | Cover يسرّب Output B                                | خرق cover purity                    | ID/reference validation قبل bytes                           |
| عالٍ    | ZIP يختلف حسب OS/timezone/library                   | فشل determinism                     | fixed headers/order/codec + double-run/cross-TZ tests       |
| عالٍ    | checksum reference cycle                            | manifest غير قابل للبناء            | سياسة D4 واختبارات صريحة                                    |
| عالٍ    | ZIP traversal/decompression bomb                    | أمن/نفاد موارد                      | entry/path/size/ratio caps قبل allocation                   |
| عالٍ    | العقد القديم غير كافٍ                               | كسر API أو تنفيذ ناقص               | additive contract فقط                                       |
| عالٍ    | Group plans غير موجودة                              | Prompt Pack ناقص                    | partial omission، بلا توليد نص                              |
| عالٍ    | registries فارغة                                    | أسماء أو restore dependency ناقصة   | manifests injected read-only؛ missing libraries flagged     |
| عالٍ    | schema الحالي واسع في maps                          | manifest malformed يمر              | schema tightening + relationship validation                 |
| عالٍ    | import architecture غير مغلق تمامًا                 | Export يستورد Persistence           | architecture test جديد                                      |
| متوسط   | project عربي ينتج slug فارغًا/متصادمًا              | overwrite/path issues               | stable fallback + deterministic suffix                      |
| متوسط   | large history/100 prompts يستهلك الذاكرة            | بطء/تعطل                            | streaming/bounded buffers + stress tests                    |
| متوسط   | dependency ZIP جديدة                                | audit أو bundle risk                | pinned minimal package أو audited internal codec            |
| متوسط   | README/package metadata قديمان                      | التباس حالة المشروع                 | تحديث توثيق Phase 10 فقط عند الدفعة النهائية                |
| متوسط   | 88 `as never` موروثة في tests                       | تعارض إن أصبح الحظر repository-wide | لا استعمال جديد؛ corrective منفصل إن طُلب                   |

---

## 11. ترتيب التنفيذ الصحيح

التنفيذ المقترح يتبع EX §3→§23 وImplementation Guide §16، ويقف بعد كل دفعة لعرض النتائج والحصول
على الموافقة.

### Batch 10.1 — العقود والحدود

- إضافة العقود الغنية additive مع إبقاء العقد القديم.
- تعريف artifact/result/ports/cancellation/progress/events types.
- ضبط config limits.
- سد architecture boundaries.
- إنشاء fixtures معيارية وcontract tests.

**لا formatter ولا ZIP في هذه الدفعة.**

### Batch 10.2 — Scope، Validation، Selection، Ordering

- كل operational scopes.
- allowlisted artifact projection.
- blocking/partial rules.
- A/B linkage وcover purity.
- session/group/scene/A/B/cover ordering والـnumbering map.
- عدم mutation وhostile-input protection.

### Batch 10.3 — TXT، Markdown، JSON، Bytes

- UTF-8 no BOM وLF.
- TXT وMarkdown sections.
- readable JSON وcanonical checksum JSON.
- byte-for-byte prompt preservation.
- no runtime/secret/path/artwork-byte leakage.

### Batch 10.4 — Checksums، Naming، ZIP، Manifest

- SHA-256 policy.
- ASCII/Windows-safe names وcollision suffixes.
- deterministic ZIP/fixed epoch/sorted entries.
- manifest/checksums وفق D4.
- golden masters وdouble-run determinism.

### Batch 10.5 — Clipboard وDelivery وCancellation

- single/multi payloads وmandatory banner.
- Clipboard port، typed failures، retry، identical TXT fallback.
- download artifact result.
- progress وcancellation بلا partial artifact.

لا يبدأ UI Export Center؛ تختبر ports عند حدود المحرك فقط.

### Batch 10.6 — Backup، Restore، Prompt Pack

- full/session/version backup.
- safe parse/checksum/schema/migration preview.
- deterministic Merge/Replace plan.
- atomic Persistence apply primitive وrollback.
- missing-library/missing-artwork behavior.
- Prompt Pack الكامل للنصوص المتوفرة، والـomissions الصريحة.

### Batch 10.7 — Events، Security، Stress، Closure

- start + terminal events لكل export/restore/copy.
- event payload redaction.
- traversal/symlink/depth/size/ratio tests.
- 50 scenes / 100 prompts وlarge history.
- QA traceability T146–T175 وEX T01–T84.
- تحديث توثيق Phase 10 غير المعياري فقط.
- final source scan: لا implementation placeholders، لا markers مؤجلة، لا استعمال جديد لـ
  `as never`، ولا تعديل `docs/spec/`.

---

## 12. بوابات كل دفعة

بعد كل Batch، وبالترتيب نفسه، يجب تشغيل:

```text
npm ci
npm audit
npm audit --omit=dev
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run verify:determinism
npm run build
npm run verify
npm run verify:full
```

شرط الانتقال:

- كل أمر `EXIT CODE 0`.
- إرسال ما نُفذ والملفات المتغيرة ونتائج الأوامر وما تبقى.
- التوقف بعد التقرير وعدم بدء الدفعة التالية قبل موافقة المستخدم.
- لا استخدام `npm audit fix --force`.
- عند فشل أي بوابة: لا الانتقال؛ تشخيص السبب وإصلاحه داخل نطاق الدفعة ثم إعادة السلسلة كاملة.

لتقليل العمل المعاد من دون تخفيف الجودة: يبدأ كل Batch من آخر checkpoint معتمد، يغير الملفات
المتأثرة فقط، ولا يعيد توليد عمل مكتمل. تظل البوابات الإحدى عشرة إلزامية كما طلب المستخدم.

---

## 13. قائمة التغيير المتوقعة بعد الاعتماد

### ملفات ستُستبدل محتوياتها الفارغة

- `src/engines/export-engine/index.ts`
- `src/export/index.ts`

### ملفات مرشحة لتحديث additive

- `src/shared/contracts/engine-contracts.ts`
- `src/shared/contracts/export-refinements.ts`
- `src/shared/domain-model/export-manifest.ts`
- `src/shared/domain-model/enums.ts`
- `src/shared/domain-model/events.ts`
- `src/shared/errors/registry.ts` فقط إذا لزم تصحيح metadata لأكواد موجودة، لا اختراع كود
- `src/config/app-config.ts`
- `schemas/domain.schema.json`
- `schemas/export-manifest.schema.json` فقط إذا احتاج wrapper تغييرًا
- `src/persistence/index.ts`
- `package.json` و`package-lock.json` فقط إذا اعتمد ZIP dependency بعد التحقق

### ملفات جديدة متوقعة

- وحدات `src/engines/export-engine/` و`src/export/` المبينة في §6.
- وحدة Persistence ضيقة لتطبيق Restore plan.
- `test/export-engine/` ومجموعة fixtures/golden masters.
- توثيق Phase 10 خارج `docs/spec/`.

لن تُعدّل ملفات محركات Phase 09 أو `docs/spec/` إلا إذا ظهر تعارض حتمي جديد؛ عندها يتوقف العمل
ويُعرض blocker بدل التوسع تلقائيًا.

---

## 14. معايير اكتمال Phase 10

لا تعتبر Phase 10 مكتملة إلا عند تحقق جميع الآتي:

1. AC-1 إلى AC-54 في EX §24.
2. QA master T146–T175.
3. مصفوفة EX §25 T01–T84 مغطاة آليًا حيث يمكن.
4. TXT/MD/JSON/ZIP bytes حتمية.
5. prompt bytes مطابقة للمصدر.
6. A/B numbering/linkage ثابتان.
7. cover A-only.
8. partial export بلا omission صامت.
9. backup/restore validation وrollback.
10. no runtime/secrets/paths/artwork bytes.
11. ZIP traversal/bomb limits.
12. start + terminal events بلا prompt payload.
13. كل البوابات الإحدى عشرة بخروج 0.
14. `docs/spec/` byte-identical لخط الأساس.
15. لا Orchestrator أو UI Export Center أو future extension ضمن التغيير.

---

## 15. نقطة الاعتماد

**الحالة الحالية:** `REPORT COMPLETE — IMPLEMENTATION NOT STARTED — AWAITING APPROVAL`

لا توجد أي شيفرة Phase 10 مكتوبة. التغيير الوحيد بعد فحص الحزمة هو هذا التقرير.

لبدء التنفيذ وفق القرارات والخطة أعلاه، تكون الموافقة الصريحة المقترحة:

> اعتمد تقرير PHASE10-GAP-ANALYSIS وابدأ Batch 10.1 فقط.
