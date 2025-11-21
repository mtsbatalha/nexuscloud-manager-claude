import { Connection, ConnectionType, FileItem } from '../types';

// Service for fetching files from remote connections
export const getFilesForConnection = async (connectionOrId: string | Connection, remotePath: string = '/'): Promise<FileItem[]> => {
  let connName = 'Unknown';
  let connId = '';
  let connType: ConnectionType | undefined;
  let connHost = '';
  let connPort: number | undefined;
  let connSecure = false;

  if (typeof connectionOrId === 'string') {
    // String ID passed - this shouldn't happen in production
    // Return empty array since we don't have connection details
    console.warn('getFilesForConnection called with string ID - connection object required');
    return [];
  } else {
    connId = connectionOrId.id;
    connName = connectionOrId.name;
    connType = connectionOrId.type;
    connHost = connectionOrId.host || '';
    connPort = connectionOrId.port;
    connSecure = connectionOrId.secure || false;
  }

  const token = localStorage.getItem('nexus_token');

  // SFTP Connection
  if (connType === ConnectionType.SFTP && connHost) {
    try {
      const res = await fetch('/api/fs/sftp/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          host: connHost,
          port: connPort,
          connectionId: connId,
          path: remotePath
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.map((f: any) => ({ ...f, connectionId: connId, connectionName: connName }));
      } else {
        const error = await res.json();
        console.error("Erro SFTP:", error.error);
        throw new Error(error.error || 'Erro ao listar arquivos SFTP');
      }
    } catch (e: any) {
      console.error("Erro ao listar SFTP:", e);
      throw e;
    }
  }

  // FTP/FTPS Connection
  if (connType === ConnectionType.FTP && connHost) {
    try {
      const res = await fetch('/api/fs/ftp/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          host: connHost,
          port: connPort,
          connectionId: connId,
          secure: connSecure,
          path: remotePath
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.map((f: any) => ({ ...f, connectionId: connId, connectionName: connName }));
      } else {
        const error = await res.json();
        console.error("Erro FTP:", error.error);
        throw new Error(error.error || 'Erro ao listar arquivos FTP');
      }
    } catch (e: any) {
      console.error("Erro ao listar FTP:", e);
      throw e;
    }
  }

  // Local filesystem
  if (connType === ConnectionType.LOCAL && connHost) {
    try {
      const queryPath = `?path=${encodeURIComponent(connHost)}`;
      const res = await fetch(`/api/fs/list${queryPath}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        return data.map((f: any) => ({ ...f, connectionId: connId, connectionName: connName }));
      } else {
        const error = await res.json();
        throw new Error(error.error || 'Erro ao listar arquivos locais');
      }
    } catch (e: any) {
      console.error("Erro ao listar Local:", e);
      throw e;
    }
  }

  // S3 Connection
  if (connType === ConnectionType.S3) {
    try {
      // Parse bucket from path if provided
      let bucket = '';
      let prefix = '';

      if (remotePath && remotePath !== '/') {
        const parts = remotePath.split('/').filter(Boolean);
        if (parts.length > 0) {
          bucket = parts[0];
          if (parts.length > 1) {
            prefix = parts.slice(1).join('/') + '/';
          }
        }
      }

      const res = await fetch('/api/fs/s3/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          host: connHost,
          connectionId: connId,
          bucket,
          prefix,
          region: (connectionOrId as any).region || 'us-east-1'
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.map((f: any) => ({ ...f, connectionId: connId, connectionName: connName }));
      } else {
        const error = await res.json();
        console.error("Erro S3:", error.error);
        throw new Error(error.error || 'Erro ao listar arquivos S3');
      }
    } catch (e: any) {
      console.error("Erro ao listar S3:", e);
      throw e;
    }
  }

  // SMB Connection
  if (connType === ConnectionType.SMB) {
    try {
      const res = await fetch('/api/fs/smb/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          host: connHost,
          connectionId: connId,
          path: remotePath
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.map((f: any) => ({ ...f, connectionId: connId, connectionName: connName }));
      } else {
        const error = await res.json();
        console.error("Erro SMB:", error.error);
        throw new Error(error.suggestion || error.error || 'Erro ao listar arquivos SMB');
      }
    } catch (e: any) {
      console.error("Erro ao listar SMB:", e);
      throw e;
    }
  }

  // NFS Connection
  if (connType === ConnectionType.NFS) {
    try {
      const res = await fetch('/api/fs/nfs/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          host: connHost,
          connectionId: connId,
          path: remotePath,
          mountPoint: (connectionOrId as any).mountPoint
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.map((f: any) => ({ ...f, connectionId: connId, connectionName: connName }));
      } else {
        const error = await res.json();
        console.error("Erro NFS:", error.error);
        throw new Error(error.suggestion || error.error || 'Erro ao listar arquivos NFS');
      }
    } catch (e: any) {
      console.error("Erro ao listar NFS:", e);
      throw e;
    }
  }

  // Cloud providers (Google Drive, Dropbox, OneDrive) - via Rclone
  if (connType === ConnectionType.GDRIVE || connType === ConnectionType.DROPBOX || connType === ConnectionType.ONEDRIVE) {
    try {
      // Usar o nome da conexão como remote name no rclone
      const remoteName = connName.replace(/[^a-zA-Z0-9_]/g, '_');

      const res = await fetch('/api/rclone/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          remote: remoteName,
          path: remotePath === '/' ? '' : remotePath
        })
      });

      if (res.ok) {
        const data = await res.json();
        return data.map((f: any) => ({ ...f, connectionId: connId, connectionName: connName }));
      } else {
        const error = await res.json();
        console.error(`Erro ${connType}:`, error.error);
        throw new Error(error.error || `Erro ao listar arquivos ${connType}`);
      }
    } catch (e: any) {
      console.error(`Erro ao listar ${connType}:`, e);
      throw e;
    }
  }

  // Unknown connection type
  console.warn(`Unknown connection type: ${connType}`);
  return [];
};
