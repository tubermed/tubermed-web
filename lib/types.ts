// Backend response types — keep in sync with /api/transcribe shape.

export interface UncertainSpan {
  field: string;
  start: number;
  end: number;
  original: string;
  suggestion?: string;
  reason?: string;
}

export interface Medication {
  inn: string;
  dose?: string;
  regimen?: string;
  route?: string;
  duration?: string;
}

export interface ComorbidDiagnosis {
  diagnoza: string;
  mkb: string;
}

export interface MedAlert {
  drug: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  reason: string;
  action: string;
}

export interface TranscribeFields {
  anamneza?: string;
  alergii?: string[];
  obektivno?: string;
  izsledvania?: string;
  terapia?: string;
  medications_list?: Medication[];
  osnovna_diagnoza?: string;
  osnovna_mkb?: string;
  pridruzhavashti?: ComorbidDiagnosis[];
  napravlenia?: string;
  naznacheni?: string;
  uncertain_spans?: UncertainSpan[];
  med_alerts?: MedAlert[];
  _disclaimer?: string;
}

export interface TranscribeResult {
  consultationId: string;
  transcript: string;
  fields: TranscribeFields;
}

export interface SessionInit {
  sessionId: string;
  mobileUrl: string;
  expiresAt: string;
}

export type SessionStatus =
  | { status: 'waiting' }
  | { status: 'processing' }
  | { status: 'done'; result: TranscribeResult }
  | { status: 'error'; error_msg?: string };

export type WsMessage =
  | { type: 'processing' }
  | { type: 'result'; consultationId: string; transcript: string; fields: TranscribeFields }
  | { type: 'error'; message: string };
