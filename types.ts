
export enum ConnectionType {
  SFTP = 'SFTP',
  FTP = 'FTP',
  S3 = 'S3',
  GDRIVE = 'Google Drive',
  DROPBOX = 'Dropbox',
  ONEDRIVE = 'OneDrive',
  SMB = 'SMB',
  NFS = 'NFS',
  LOCAL = 'Local'
}

export interface Connection {
  id: string;
  name: string;
  type: ConnectionType;
  status: 'connected' | 'disconnected' | 'error';
  host?: string;
  port?: number; // Connection port (22 for SFTP, 21 for FTP, 990 for FTPS, 445 for SMB)
  lastSync?: string;
  storageUsed?: number; // in GB
  storageLimit?: number; // in GB
  accountName?: string; // Email ou usuario conectado

  // Protocol specific fields
  domain?: string; // SMB
  mountOptions?: string; // NFS
  secure?: boolean; // For FTPS
  defaultPath?: string; // Default remote path to open when browsing files

  // Note: Credentials are stored securely on the backend, not in frontend state
}

export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size: number; // bytes
  modifiedAt: string;
  mimeType?: string;
  parentId: string | null;
  path: string;
  content?: string; // Mock content for text files
  connectionId?: string; // Added to track origin
  connectionName?: string; // Added for display
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export type SyncFrequency = 'manual' | 'realtime' | 'daily' | 'weekly' | 'monthly';

export interface SyncJob {
  id: string;
  name: string; // Nome amigável do job
  sourceId: string;
  destinationId: string;
  type: 'one-way' | 'two-way'; // Backup vs Sync
  progress: number;
  status: 'running' | 'completed' | 'failed' | 'queued' | 'idle';
  filesProcessed: number;
  totalFiles: number;
  
  // Scheduling
  frequency: SyncFrequency;
  scheduledTime?: string; // "14:00"
  weekDay?: number; // 0-6 for weekly
  
  // Filters
  excludePatterns: string[]; // ["*.tmp", ".git"]
  
  lastRun?: string;
  nextRun?: string;
}

export interface SyncLogEntry {
  id: string;
  jobId: string;
  jobName: string;
  startTime: string;
  endTime: string;
  status: 'success' | 'failed' | 'warning';
  filesTransferred: number;
  sizeTransferred: number; // bytes
  details: string; // Mensagem de erro ou resumo
  sourceName: string;
  destinationName: string;
}

export interface DuplicateCandidate {
  fileA: FileItem;
  fileB: FileItem;
  similarity: number; // 0 to 100
  reason: string;
  suggestion: 'keep_a' | 'keep_b' | 'manual';
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}
