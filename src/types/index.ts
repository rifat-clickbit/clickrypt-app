export type AppStartupState =
  | 'INITIALIZING'
  | 'DATABASE_CONNECTING'
  | 'DATABASE_READY'
  | 'LOADING_CREDENTIALS'
  | 'DECRYPTING_CREDENTIALS'
  | 'READY'
  | 'ERROR';

export type AuthErrorCode =
  | 'INVALID_MASTER_PASSWORD'
  | 'VAULT_LOCKED'
  | 'UNLOCKED_KEY_MISSING'
  | 'PRIVATE_KEY_MISSING'
  | 'PRIVATE_KEY_DECRYPT_FAILED'
  | 'BIOMETRICS_UNAVAILABLE'
  | 'BIOMETRICS_CANCELLED'
  | 'RESOURCE_KEY_UNWRAP_FAILED'
  | 'RESOURCE_DECRYPT_FAILED'
  | 'USER_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export interface AuthResult {
  success: boolean;
  error?: string;
  code?: AuthErrorCode;
}

export type MasterPassword = string;
export type EncryptedPrivateKey = string;
export type UnlockedPrivateKey = string;
export type SymmetricKey = string;
export type EncryptedSymmetricKey = string;
export type TOTPSecret = string;

export interface PasswordDiagnosticLog {
  passwordRecordFound: boolean;
  encryptedPasswordPresent: boolean;
  decryptionStarted?: number;
  decryptionCompleted?: number;
  decryptionSuccess: boolean;
  passwordStateInitialized: boolean;
  error?: string;
}

export interface UserProfile {
  id: string;
  authId?: string;
  email: string;
  name: string;
  role: 'Owner' | 'Admin' | 'User' | 'External';
  accountMode: 'personal' | 'organization';
  status?: 'Active' | 'Suspended' | 'Invited';
  publicKey?: string;
  encryptedPrivateKey?: string;
  avatarUrl?: string;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  organization?: {
    id: string;
    domain: string;
    verificationStatus: 'pending' | 'verified';
    openEnrollment: boolean;
  } | null;
}

export interface ResourceSecret {
  userId: string;
  encryptedData: string;
}

export interface SharedMemberInfo {
  id: string;
  name: string;
  email: string;
  sharedAt?: string;
}

export interface VaultItem {
  id: string;
  name: string;
  username: string;
  url: string;
  folderId?: string | null;
  ownerId: string;
  ownerName?: string;
  ownerEmail?: string;
  isPrivateOnly?: boolean;
  isExternalShared?: boolean;
  score?: number;
  strength?: 'Strong' | 'Good' | 'Better' | 'Weak';
  lastModified: string;
  isOld?: boolean;
  isLeaked?: boolean;
  secrets: ResourceSecret[];
  tags?: string[];
  sharedWith?: string[];
  sharedWithMembers?: SharedMemberInfo[];
  mode?: 'personal' | 'organization';
  sortOrder?: number;
  itemType?: 'login' | 'card' | 'note';
  noteContent?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  // Decrypted & encrypted values for local display
  encryptedPassword?: string;
  decryptedPassword?: string;
  encryptedSymmetricKey?: string;
}

export interface FolderItem {
  id: string;
  name: string;
  description?: string;
  color?: string;
  itemCount: number;
  lastModified: string;
  isPrivateOnly?: boolean;
  mode?: 'personal' | 'organization';
  creatorId?: string;
  sortOrder?: number;
}

export interface GroupMember {
  userId: string;
  role: 'Owner' | 'Admin' | 'User';
}

export interface GroupItem {
  id: string;
  name: string;
  description: string;
  members: GroupMember[];
  memberIds?: string[];
  folderIds?: string[];
  assignedFolderIds?: string[];
  assignedResourceIds?: string[];
  createdBy?: string;
  createdAt?: string;
  lastActive: string;
  sortOrder?: number;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  action: string;
  userId: string;
  resourceId?: string;
  groupId?: string;
  details?: string;
  mode?: 'personal' | 'organization';
}
