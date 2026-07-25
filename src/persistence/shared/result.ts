export type PersistenceFailureCode =
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_ALREADY_EXISTS'
  | 'OVERWRITE_REQUIRED'
  | 'CORRUPT_JSON'
  | 'VALIDATION_FAILED'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_SPECIFICATION_BLOCKED'
  | 'STORAGE_FAILURE'
  | 'SNAPSHOT_CORRUPT'
  | 'SNAPSHOT_NOT_FOUND'
  | 'RETENTION_POLICY_INVALID'
  | 'RETENTION_POLICY_UNSUPPORTED'
  | 'RESTORE_FAILED'
  | 'AUTOSAVE_NOT_FOUND'
  | 'RECOVERY_NOT_AVAILABLE'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_ALREADY_EXISTS'
  | 'ASSET_CORRUPT'
  | 'ASSET_CROSS_PROJECT'
  | 'ASSET_INVALID_PNG'
  | 'ASSET_RESOURCE_LIMIT'
  | 'ASSET_METADATA_INVALID';

export type PersistenceFailurePhase =
  | 'serialize'
  | 'deserialize'
  | 'validate'
  | 'migrate'
  | 'read'
  | 'write'
  | 'snapshot'
  | 'restore'
  | 'retention'
  | 'autosave'
  | 'recovery'
  | 'asset_register'
  | 'asset_read';

export type PersistenceFailureSeverity = 'warning' | 'error' | 'blocking';

export type PersistenceRecoveryAction =
  | 'none'
  | 'retry'
  | 'confirm_overwrite'
  | 'choose_valid_data'
  | 'restore_previous_version'
  | 'use_supported_application_version'
  | 'resolve_specification_blocker'
  | 're_register_asset'
  | 'select_correct_project';

export type PersistenceCauseCategory =
  | 'validation'
  | 'serialization'
  | 'storage'
  | 'integrity'
  | 'migration'
  | 'security'
  | 'configuration'
  | 'not_found'
  | 'conflict'
  | 'unknown';

interface FailureDescriptor {
  readonly severity: PersistenceFailureSeverity;
  readonly messageAr: string;
  readonly messageEn: string;
  readonly retryable: boolean;
  readonly recoveryAction: PersistenceRecoveryAction;
  readonly causeCategory: PersistenceCauseCategory;
}

export const PERSISTENCE_FAILURE_CATALOG: Readonly<
  Record<PersistenceFailureCode, FailureDescriptor>
> = Object.freeze({
  PROJECT_NOT_FOUND: {
    severity: 'blocking',
    messageAr: 'تعذر العثور على المشروع المحفوظ.',
    messageEn: 'The saved project could not be found.',
    retryable: false,
    recoveryAction: 'choose_valid_data',
    causeCategory: 'not_found',
  },
  PROJECT_ALREADY_EXISTS: {
    severity: 'blocking',
    messageAr: 'يوجد مشروع محفوظ بالفعل بهذا المعرّف الداخلي.',
    messageEn: 'A saved project already exists for this internal identifier.',
    retryable: false,
    recoveryAction: 'confirm_overwrite',
    causeCategory: 'conflict',
  },
  OVERWRITE_REQUIRED: {
    severity: 'blocking',
    messageAr: 'يلزم تأكيد صريح قبل استبدال المشروع المحفوظ.',
    messageEn: 'Explicit confirmation is required before replacing the saved project.',
    retryable: false,
    recoveryAction: 'confirm_overwrite',
    causeCategory: 'conflict',
  },
  CORRUPT_JSON: {
    severity: 'blocking',
    messageAr: 'بيانات المشروع المحفوظة تالفة أو ليست JSON صالحًا.',
    messageEn: 'The stored project data is corrupt or is not valid JSON.',
    retryable: false,
    recoveryAction: 'restore_previous_version',
    causeCategory: 'serialization',
  },
  VALIDATION_FAILED: {
    severity: 'blocking',
    messageAr: 'فشل التحقق البنيوي أو المرجعي من بيانات المشروع.',
    messageEn: 'Project structural or referential validation failed.',
    retryable: false,
    recoveryAction: 'choose_valid_data',
    causeCategory: 'validation',
  },
  UNSUPPORTED_SCHEMA_VERSION: {
    severity: 'blocking',
    messageAr: 'تم إنشاء البيانات بإصدار مخطط أحدث من الإصدار المدعوم.',
    messageEn: 'The data was created with a schema version newer than this application supports.',
    retryable: false,
    recoveryAction: 'use_supported_application_version',
    causeCategory: 'migration',
  },
  MIGRATION_FAILED: {
    severity: 'blocking',
    messageAr: 'فشل ترحيل البيانات، وتم الحفاظ على النسخة الأصلية دون تعديل.',
    messageEn: 'Data migration failed; the original data was preserved unchanged.',
    retryable: false,
    recoveryAction: 'restore_previous_version',
    causeCategory: 'migration',
  },
  MIGRATION_SPECIFICATION_BLOCKED: {
    severity: 'blocking',
    messageAr: 'تعذر تنفيذ الترحيل لأن المواصفات لا تحدد التحويل المطلوب بصورة كاملة.',
    messageEn:
      'Migration is blocked because the specifications do not fully define the required transformation.',
    retryable: false,
    recoveryAction: 'resolve_specification_blocker',
    causeCategory: 'configuration',
  },
  STORAGE_FAILURE: {
    severity: 'blocking',
    messageAr: 'فشلت عملية التخزين الذرية ولم يتم اعتماد أي كتابة جزئية.',
    messageEn: 'The atomic storage operation failed and no partial write was committed.',
    retryable: true,
    recoveryAction: 'retry',
    causeCategory: 'storage',
  },
  SNAPSHOT_CORRUPT: {
    severity: 'blocking',
    messageAr: 'لقطة الإصدار تالفة أو لا تطابق بصمة الحالة المحفوظة.',
    messageEn: 'The version snapshot is corrupt or does not match its stored state hash.',
    retryable: false,
    recoveryAction: 'restore_previous_version',
    causeCategory: 'integrity',
  },
  SNAPSHOT_NOT_FOUND: {
    severity: 'blocking',
    messageAr: 'تعذر العثور على لقطة الإصدار المطلوبة.',
    messageEn: 'The requested version snapshot could not be found.',
    retryable: false,
    recoveryAction: 'choose_valid_data',
    causeCategory: 'not_found',
  },
  RETENTION_POLICY_INVALID: {
    severity: 'blocking',
    messageAr: 'إعداد سياسة الاحتفاظ غير صالح.',
    messageEn: 'The retention policy configuration is invalid.',
    retryable: false,
    recoveryAction: 'choose_valid_data',
    causeCategory: 'configuration',
  },
  RETENTION_POLICY_UNSUPPORTED: {
    severity: 'blocking',
    messageAr: 'سياسة الحذف المطلوبة غير مدعومة بأمان لأن المواصفات لا تحدد ضغط سلسلة الإصدارات.',
    messageEn:
      'The requested pruning policy cannot be applied safely because lineage compaction is not specified.',
    retryable: false,
    recoveryAction: 'resolve_specification_blocker',
    causeCategory: 'configuration',
  },
  RESTORE_FAILED: {
    severity: 'blocking',
    messageAr: 'فشلت استعادة المشروع دون تغيير البيانات المحفوظة الحالية.',
    messageEn: 'Project restoration failed without changing the currently stored data.',
    retryable: false,
    recoveryAction: 'restore_previous_version',
    causeCategory: 'integrity',
  },
  AUTOSAVE_NOT_FOUND: {
    severity: 'warning',
    messageAr: 'لا توجد نسخة حفظ تلقائي متاحة لهذا المشروع.',
    messageEn: 'No autosave slot is available for this project.',
    retryable: false,
    recoveryAction: 'none',
    causeCategory: 'not_found',
  },
  RECOVERY_NOT_AVAILABLE: {
    severity: 'blocking',
    messageAr: 'لا توجد لقطة مستقلة صالحة يمكن استخدامها للاستعادة.',
    messageEn: 'No independent valid snapshot is available for recovery.',
    retryable: false,
    recoveryAction: 'choose_valid_data',
    causeCategory: 'not_found',
  },
  ASSET_NOT_FOUND: {
    severity: 'blocking',
    messageAr: 'تعذر العثور على أصل PNG أو بياناته الوصفية.',
    messageEn: 'The PNG asset or its metadata could not be found.',
    retryable: false,
    recoveryAction: 're_register_asset',
    causeCategory: 'not_found',
  },
  ASSET_ALREADY_EXISTS: {
    severity: 'blocking',
    messageAr: 'تم تسجيل أصل مطابق بالفعل.',
    messageEn: 'An identical asset registration already exists.',
    retryable: false,
    recoveryAction: 'choose_valid_data',
    causeCategory: 'conflict',
  },
  ASSET_CORRUPT: {
    severity: 'blocking',
    messageAr: 'بيانات أصل PNG تالفة أو لا تطابق البصمة المحفوظة.',
    messageEn: 'The PNG asset data is corrupt or does not match its stored hash.',
    retryable: false,
    recoveryAction: 're_register_asset',
    causeCategory: 'integrity',
  },
  ASSET_CROSS_PROJECT: {
    severity: 'blocking',
    messageAr: 'لا يمكن استخدام أصل PNG تابع لمشروع آخر.',
    messageEn: 'A PNG asset owned by another project cannot be used.',
    retryable: false,
    recoveryAction: 'select_correct_project',
    causeCategory: 'security',
  },
  ASSET_INVALID_PNG: {
    severity: 'blocking',
    messageAr: 'ملف PNG غير صالح أو بنيته غير مكتملة.',
    messageEn: 'The PNG file is invalid or structurally incomplete.',
    retryable: false,
    recoveryAction: 're_register_asset',
    causeCategory: 'validation',
  },
  ASSET_RESOURCE_LIMIT: {
    severity: 'blocking',
    messageAr: 'يتجاوز ملف PNG حدود الموارد الآمنة المحددة في إعدادات التطبيق.',
    messageEn: 'The PNG exceeds the safe resource limits configured by the application.',
    retryable: false,
    recoveryAction: 'choose_valid_data',
    causeCategory: 'security',
  },
  ASSET_METADATA_INVALID: {
    severity: 'blocking',
    messageAr: 'بيانات أصل PNG الوصفية غير صالحة.',
    messageEn: 'The PNG asset metadata is invalid.',
    retryable: false,
    recoveryAction: 'choose_valid_data',
    causeCategory: 'validation',
  },
});

export interface PersistenceFailure {
  readonly code: PersistenceFailureCode;
  readonly phase: PersistenceFailurePhase;
  readonly severity: PersistenceFailureSeverity;
  /** Backward-compatible alias of messageEn. */
  readonly message: string;
  readonly messageAr: string;
  readonly messageEn: string;
  readonly retryable: boolean;
  readonly recoveryAction: PersistenceRecoveryAction;
  readonly causeCategory: PersistenceCauseCategory;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type PersistenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PersistenceFailure };

export interface FailureOptions {
  readonly messageEn?: string;
  readonly messageAr?: string;
  readonly retryable?: boolean;
  readonly severity?: PersistenceFailureSeverity;
  readonly recoveryAction?: PersistenceRecoveryAction;
  readonly causeCategory?: PersistenceCauseCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

function looksAbsolutePath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value);
}

function sanitizeDetail(value: unknown, depth = 0, keyName?: string): unknown {
  if (depth > 6) return '[detail depth limited]';
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return '[binary omitted]';
  if (typeof value === 'string') {
    if (keyName !== 'jsonPointer' && looksAbsolutePath(value)) return '[absolute path redacted]';
    return value.length > 512 ? `${value.slice(0, 512)}…` : value;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitizeDetail(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, item] of Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      if (/secret|token|rawbytes|payload|serializedproject/i.test(key)) {
        result[key] = '[redacted]';
      } else {
        result[key] = sanitizeDetail(item, depth + 1, key);
      }
    }
    return result;
  }
  return String(value);
}

function sanitizeDetails(
  details: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!details) return undefined;
  return sanitizeDetail(details) as Readonly<Record<string, unknown>>;
}

function safeCauseDetails(cause: unknown): Readonly<Record<string, unknown>> | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) {
    return Object.freeze({ causeName: cause.name || 'Error' });
  }
  return Object.freeze({ causeType: cause === null ? 'null' : typeof cause });
}

export function ok<T>(value: T): PersistenceResult<T> {
  return { ok: true, value };
}

/**
 * Creates a locally-namespaced Phase 1 infrastructure failure. The catalog supplies
 * bilingual user-facing text and safe recovery guidance; callers may add a more
 * specific English/Arabic message without exposing raw payloads or paths.
 */
export function fail<T = never>(
  code: PersistenceFailureCode,
  phase: PersistenceFailurePhase,
  optionsOrMessage?: FailureOptions | string,
  legacyRetryable?: boolean,
  legacyDetails?: Readonly<Record<string, unknown>>,
): PersistenceResult<T> {
  const descriptor = PERSISTENCE_FAILURE_CATALOG[code];
  const options: FailureOptions =
    typeof optionsOrMessage === 'string'
      ? { messageEn: optionsOrMessage, retryable: legacyRetryable, details: legacyDetails }
      : (optionsOrMessage ?? {});
  const messageEn = options.messageEn ?? descriptor.messageEn;
  const messageAr = options.messageAr ?? descriptor.messageAr;
  const causeDetails = safeCauseDetails(options.cause);
  const details = sanitizeDetails(
    options.details || causeDetails
      ? { ...(options.details ?? {}), ...(causeDetails ?? {}) }
      : undefined,
  );
  return {
    ok: false,
    error: {
      code,
      phase,
      severity: options.severity ?? descriptor.severity,
      message: messageEn,
      messageAr,
      messageEn,
      retryable: options.retryable ?? descriptor.retryable,
      recoveryAction: options.recoveryAction ?? descriptor.recoveryAction,
      causeCategory: options.causeCategory ?? descriptor.causeCategory,
      ...(details ? { details } : {}),
    },
  };
}
