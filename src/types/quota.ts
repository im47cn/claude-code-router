export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remainingRequests?: number;
  windowResetAt?: Date;
}

export interface QuotaInfo {
  [key: string]: any;
}