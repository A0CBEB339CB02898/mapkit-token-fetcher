/**
 * 凭证类型定义
 */
export interface Credentials {
  username?: string;
  password?: string;
}

/**
 * CLI 选项类型定义
 */
export interface CLIOptions {
  username?: string;
  password?: string;
  headless?: boolean;
}

/**
 * 浏览器操作结果
 */
export interface BrowserResult {
  token: string;
  cleanup: CleanupSummary;
  warnings: string[];
}

export interface CleanupSummary {
  scanned: number;
  expired: number;
  revoked: number;
  failed: number;
  skipped: number;
  complete: boolean;
}

export interface TaskResult {
  token?: string;
  error?: string;
  errorCode?: string;
  warnings?: string[];
  cleanup?: CleanupSummary;
}

// ========== 任务管理相关类型 ==========

/**
 * 任务状态枚举
 */
export type TaskStatus = 
  | 'pending'              // 任务已创建，等待开始
  | 'running'              // 任务执行中
  | 'waiting_verification' // 等待验证码输入
  | 'verifying'            // 正在验证
  | 'completed'            // 任务完成
  | 'failed'               // 任务失败
  | 'cancelled'            // 任务取消
  | 'timeout';             // 任务超时

/**
 * 任务结构
 */
export interface Task {
  id: string;
  status: TaskStatus;
  createdAt: Date;
  expiresAt: Date;
  deadlineAt: Date;
  verificationCode?: string;
  result?: TaskResult;
}

/**
 * 验证码提供者函数类型
 */
export type VerificationCodeProvider = () => Promise<string | null>;

// ========== 配置相关类型 ==========

/**
 * 企业微信通知配置
 */
export interface WeComConfig {
  enabled: boolean;
  webhook_url: string;
}

/**
 * 通知配置
 */
export interface NotificationConfig {
  wecom?: WeComConfig;
}

/**
 * 服务器配置
 */
export interface ServerConfig {
  port: number;
  base_url?: string;  // 用户自定义的页面 base URL
}

/**
 * 完整配置文件接口
 */
export interface FullConfig {
  apple: {
    username: string;
    password: string;
  };
  notification?: NotificationConfig;
  server?: ServerConfig;
}
