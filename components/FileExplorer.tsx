
import React, { useState, useEffect, useRef } from 'react';
import { FileItem, Connection, ConnectionType } from '../types';
import { Folder, FileText, FileImage, MoreVertical, ChevronRight, ChevronLeft, Search, Filter, Plus, Trash2, Edit, Download, FolderPlus, Loader2, UploadCloud, X, Check, Copy, FolderInput, ArrowRight, Server, Globe, ArrowUp, Share2, Link, RefreshCw, AlertCircle, Eye } from 'lucide-react';
import { getFilesForConnection } from '../services/mockData';
import { useTransfer } from '../contexts/TransferContext';

// Helper to get auth token
const getAuthToken = () => {
  return localStorage.getItem('nexus_token');
};

// Helper to check if connection is cloud provider (uses rclone)
const isCloudProvider = (type?: ConnectionType) => {
  return type === ConnectionType.GDRIVE || type === ConnectionType.DROPBOX || type === ConnectionType.ONEDRIVE;
};

interface FileExplorerProps {
  activeConnection: Connection | null;
  connections?: Connection[]; // List of all connections for cross-server ops
  onPreview: (file: FileItem) => void;
  onFilesChange?: (files: FileItem[]) => void;
  navigateToPath?: string | null;
  onNavigateComplete?: () => void;
}

const FileExplorer: React.FC<FileExplorerProps> = ({ activeConnection, connections = [], onPreview, onFilesChange, navigateToPath, onNavigateComplete }) => {
  const { addTransfer, updateTransferProgress, setTransferStatus, setTransferFailed, completeTransfer } = useTransfer();

  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [searchTerm, setSearchTerm] = useState('');

  // Action States
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileItem } | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [uploadConflictAction, setUploadConflictAction] = useState<'replace' | 'rename' | null>(null);
  const [uploadRenameValue, setUploadRenameValue] = useState('');

  // Download progress state
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFileName, setDownloadFileName] = useState('');
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState<FileItem | null>(null);
  const downloadAbortController = useRef<AbortController | null>(null);

  // Operation loading states
  const [operationLoading, setOperationLoading] = useState(false);

  // Delete notification state
  const [deleteNotification, setDeleteNotification] = useState<{ file: FileItem; timeout: NodeJS.Timeout } | null>(null);

  // Transfer interval ref for simulated progress
  const transferIntervalRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Move/Copy File State
  const [targetActionFile, setTargetActionFile] = useState<FileItem | null>(null);
  const [actionType, setActionType] = useState<'move' | 'copy' | null>(null);

  // Conflict resolution state
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictFileName, setConflictFileName] = useState('');
  const [conflictRenameValue, setConflictRenameValue] = useState('');
  const [conflictAction, setConflictAction] = useState<'replace' | 'rename' | null>(null);

  // Destination Browser State
  const [destConnection, setDestConnection] = useState<Connection | null>(null);
  const [destPath, setDestPath] = useState<string>('/');
  const [destFiles, setDestFiles] = useState<FileItem[]>([]);
  const [destLoading, setDestLoading] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  // Reset path when connection changes - use defaultPath if available
  useEffect(() => {
    setCurrentPath(activeConnection?.defaultPath || '/');
  }, [activeConnection?.id]);

  // Handle external navigation request
  useEffect(() => {
    if (navigateToPath && activeConnection) {
      setCurrentPath(navigateToPath);
      onNavigateComplete?.();
    }
  }, [navigateToPath, activeConnection]);

  // Main File Load
  useEffect(() => {
    if (activeConnection) {
      setLoading(true);
      // Pass full connection object to enable remote file listing
      getFilesForConnection(activeConnection, currentPath).then(data => {
        setFiles(data);
        onFilesChange?.(data);
        setLoading(false);
      }).catch(err => {
        console.error('Error loading files:', err);
        setFiles([]);
        onFilesChange?.([]);
        setLoading(false);
      });
    } else {
      setFiles([]);
      onFilesChange?.([]);
    }
  }, [activeConnection, currentPath]);

  // Close context menu on outside click. Ignore right-click events so
  // a contextmenu (right-click) used to open the menu doesn't immediately
  // trigger the global click handler and clear the selection.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      // Ignore right-clicks (button === 2)
      try {
        if (event && 'button' in event && event.button === 2) return;
      } catch (e) {}
      setContextMenu(null);
      setSelectedFileId(null);
    };
    const handleScroll = () => {
      setContextMenu(null);
      setSelectedFileId(null);
    };

    if (contextMenu) {
      document.addEventListener('click', handleClick);
      document.addEventListener('scroll', handleScroll, true);
      return () => {
        document.removeEventListener('click', handleClick);
        document.removeEventListener('scroll', handleScroll, true);
      };
    }
  }, [contextMenu]);

  // Destination Browser File Load
  useEffect(() => {
    if (destConnection) {
      setDestLoading(true);
      getFilesForConnection(destConnection, destPath).then(data => {
        setDestFiles(data);
        setDestLoading(false);
      }).catch(err => {
        console.error('Error loading dest files:', err);
        setDestFiles([]);
        setDestLoading(false);
      });
    } else {
      setDestFiles([]);
    }
  }, [destConnection, destPath]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // --- Actions ---

  const handleMenuClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActiveMenuId(activeMenuId === id ? null : id);
  };

  const handleDelete = async (e: React.MouseEvent, file: FileItem) => {
    e.stopPropagation();

    // Close menu immediately
    setActiveMenuId(null);

    if (!activeConnection) {
      alert('Conexão não configurada corretamente');
      return;
    }

    // Cancel previous delete notification if exists
    if (deleteNotification) {
      clearTimeout(deleteNotification.timeout);
      setDeleteNotification(null);
    }

    // Remove from view immediately
    setFiles(prev => prev.filter(f => f.id !== file.id));

    // Setup auto-delete after 5 seconds
    const timeout = setTimeout(async () => {
      // Perform actual deletion
      try {
        const token = getAuthToken();
        const remotePath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
        let response;

        if (isCloudProvider(activeConnection.type)) {
          if (!activeConnection.accountName) {
            throw new Error('Conexão cloud não configurada');
          }
          response = await fetch(`/api/rclone/files?remote=${encodeURIComponent(activeConnection.accountName)}&path=${encodeURIComponent(remotePath)}&isDir=${file.type === 'folder'}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
        } else if (activeConnection.type === ConnectionType.SFTP) {
          const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
          response = await fetch('/api/fs/sftp/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              host: activeConnection.host, port: activeConnection.port,
              connectionId: activeConnection.id, path: fullPath, isDir: file.type === 'folder'
            })
          });
        } else if (activeConnection.type === ConnectionType.FTP) {
          const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
          response = await fetch('/api/fs/ftp/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              host: activeConnection.host, port: activeConnection.port,
              connectionId: activeConnection.id, path: fullPath, isDir: file.type === 'folder'
            })
          });
        } else if (activeConnection.type === ConnectionType.SMB) {
          const fullPath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
          response = await fetch('/api/fs/smb/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              host: activeConnection.host, share: activeConnection.share,
              connectionId: activeConnection.id, path: fullPath, isDir: file.type === 'folder'
            })
          });
        } else if (activeConnection.type === ConnectionType.NFS) {
          const fullPath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
          response = await fetch('/api/fs/nfs/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              mountPoint: activeConnection.mountPoint, path: fullPath, isDir: file.type === 'folder'
            })
          });
        } else if (activeConnection.type === ConnectionType.S3) {
          const key = file.s3Key || (currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`);
          response = await fetch('/api/fs/s3/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              host: activeConnection.host, bucket: activeConnection.bucket,
              connectionId: activeConnection.id, region: activeConnection.region, keys: [key]
            })
          });
        } else {
          throw new Error(`Operação não suportada para ${activeConnection.type}`);
        }

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Erro ao excluir');
        }
      } catch (error: any) {
        console.error('Delete error:', error);
        alert(`Erro ao excluir permanentemente: ${error.message}`);
        // Restore file on error
        setFiles(prev => [...prev, file]);
      }
      setDeleteNotification(null);
    }, 5000);

    setDeleteNotification({ file, timeout });
  };

  const handleUndoDelete = () => {
    if (deleteNotification) {
      clearTimeout(deleteNotification.timeout);
      // Restore file
      setFiles(prev => [...prev, deleteNotification.file]);
      setDeleteNotification(null);
    }
  };

  const handleDownload = async (e: React.MouseEvent | null, file: FileItem) => {
    if (e) e.stopPropagation();
    setActiveMenuId(null);

    if (!activeConnection) {
      alert('Conexão não configurada corretamente');
      return;
    }

    const token = getAuthToken();
    if (!token) {
      alert('Sessão expirada. Por favor, faça login novamente.');
      return;
    }

    // Start download progress
    setDownloading(true);
    setDownloadProgress(0);
    setDownloadFileName(file.name);
    setDownloadFailed(false);
    setDownloadingFile(file);

    // Create abort controller
    downloadAbortController.current = new AbortController();

    try {
      const isDir = file.type === 'folder';
      let response;
      const signal = downloadAbortController.current.signal;

      if (isCloudProvider(activeConnection.type)) {
        if (!activeConnection.accountName) throw new Error('Conexão cloud não configurada');
        const remotePath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
        const downloadUrl = `/api/rclone/download?remote=${encodeURIComponent(activeConnection.accountName)}&path=${encodeURIComponent(remotePath)}&isDir=${isDir}`;
        response = await fetch(downloadUrl, { headers: { 'Authorization': `Bearer ${token}` }, signal });
      } else if (activeConnection.type === ConnectionType.SFTP) {
        if (isDir) { setDownloading(false); alert('Download de pastas não suportado'); return; }
        const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        response = await fetch('/api/fs/sftp/download', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, port: activeConnection.port, connectionId: activeConnection.id, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.FTP) {
        if (isDir) { setDownloading(false); alert('Download de pastas não suportado'); return; }
        const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        response = await fetch('/api/fs/ftp/download', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, port: activeConnection.port, connectionId: activeConnection.id, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.SMB) {
        if (isDir) { setDownloading(false); alert('Download de pastas não suportado'); return; }
        const fullPath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
        response = await fetch('/api/fs/smb/download', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, share: activeConnection.share, connectionId: activeConnection.id, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.NFS) {
        if (isDir) { setDownloading(false); alert('Download de pastas não suportado'); return; }
        const fullPath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
        response = await fetch('/api/fs/nfs/download', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ mountPoint: activeConnection.mountPoint, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.S3) {
        if (isDir) { setDownloading(false); alert('Download de pastas não suportado'); return; }
        const key = file.s3Key || (currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`);
        response = await fetch('/api/fs/s3/download', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, bucket: activeConnection.bucket, connectionId: activeConnection.id, region: activeConnection.region, key })
        });
      } else {
        throw new Error(`Download não suportado para ${activeConnection.type}`);
      }

      if (!response.ok) {
        let errorMsg = 'Erro ao baixar';
        try { const errorData = await response.json(); errorMsg = errorData.error || errorMsg; } catch { errorMsg = `Erro ${response.status}: ${response.statusText}`; }
        throw new Error(errorMsg);
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : file.size || 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Stream não suportado');

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        setDownloadProgress(total > 0 ? Math.round((received / total) * 100) : -1);
      }

      const blob = new Blob(chunks);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setDownloadProgress(100);
      setTimeout(() => {
        setDownloading(false);
        setDownloadProgress(0);
        setDownloadFileName('');
        setDownloadingFile(null);
      }, 1000);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setDownloading(false);
        setDownloadProgress(0);
        setDownloadFileName('');
        setDownloadingFile(null);
      } else {
        console.error('Download error:', error);
        setDownloadFailed(true);
      }
    }
  };

  const handleCancelDownload = () => {
    downloadAbortController.current?.abort();
    downloadAbortController.current = null;
  };

  const handleRetryDownload = () => {
    if (downloadingFile) {
      handleDownload(null, downloadingFile);
    }
  };

  const handleDismissDownload = () => {
    setDownloading(false);
    setDownloadProgress(0);
    setDownloadFileName('');
    setDownloadFailed(false);
    setDownloadingFile(null);
  };

  const handleShare = async (e: React.MouseEvent, file: FileItem) => {
    e.stopPropagation();
    setActiveMenuId(null);

    if (!activeConnection || !isCloudProvider(activeConnection.type)) {
      alert('Compartilhamento só está disponível para provedores cloud (Google Drive, Dropbox, OneDrive)');
      return;
    }

    if (!activeConnection.accountName) {
      alert('Conexão não configurada corretamente');
      return;
    }

    setOperationLoading(true);
    try {
      const token = getAuthToken();
      const remotePath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;

      const response = await fetch('/api/rclone/publiclink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          remote: activeConnection.accountName,
          path: remotePath
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao gerar link');
      }

      // Copy to clipboard
      await navigator.clipboard.writeText(data.url);
      alert(`Link copiado para a área de transferência:\n${data.url}`);
    } catch (error: any) {
      console.error('Share error:', error);
      alert(`Erro ao compartilhar: ${error.message}`);
    } finally {
      setOperationLoading(false);
    }
  };

  // Open Modal for Copy
  const handleInitiateCopy = (e: React.MouseEvent, file: FileItem) => {
    e.stopPropagation();
    setTargetActionFile(file);
    setActionType('copy');
    setActiveMenuId(null);
    // Reset Browser
    setDestConnection(null);
    setDestPath('/');
  };

  // Open Modal for Move
  const handleInitiateMove = (e: React.MouseEvent, file: FileItem) => {
    e.stopPropagation();
    setTargetActionFile(file);
    setActionType('move');
    setActiveMenuId(null);
    // Reset Browser
    setDestConnection(null); 
    setDestPath('/');
  };

  const handleCloseModal = () => {
    setTargetActionFile(null);
    setActionType(null);
    setDestConnection(null);
    setDestPath('/');
  };

  const handleConfirmAction = async () => {
    if (!targetActionFile || !destConnection || !activeConnection) return;

    const isMove = actionType === 'move';
    const isSameConnection = destConnection.id === activeConnection?.id;

    // Check if file/folder already exists in destination
    const fileNameToCheck = conflictAction === 'rename' ? conflictRenameValue : targetActionFile.name;
    const existsInDest = destFiles.some(f =>
      f.name.toLowerCase() === fileNameToCheck.toLowerCase() &&
      f.type === targetActionFile.type
    );

    // If exists and no conflict resolution chosen yet, show conflict modal
    if (existsInDest && !conflictAction) {
      setConflictFileName(targetActionFile.name);
      setConflictRenameValue(targetActionFile.name);
      setShowConflictModal(true);
      return;
    }

    // Save values before closing modal
    const savedFile = targetActionFile;
    const savedAction = actionType;
    const savedSrcConn = activeConnection;
    const savedDstConn = destConnection;
    const savedSrcPath = currentPath;
    const savedDstPath = destPath;
    const finalFileName = conflictAction === 'rename' ? conflictRenameValue : targetActionFile.name;

    // Set source/destination display info
    const srcDisplay = `${savedSrcConn.name}:${savedSrcPath === '/' ? '' : savedSrcPath}/${savedFile.name}`;
    const dstDisplay = `${savedDstConn.name}:${savedDstPath === '/' ? '' : savedDstPath}/${finalFileName}`;

    // Add transfer to global context
    const transferId = addTransfer({
      fileName: finalFileName,
      fileSize: savedFile.size || 0,
      srcInfo: srcDisplay,
      dstInfo: dstDisplay,
      srcConnId: savedSrcConn.id,
      srcPath: savedSrcPath,
      dstConnId: savedDstConn.id,
      dstPath: savedDstPath,
      actionType: savedAction!,
      status: 'Iniciando transferência...'
    });

    // Reset conflict states
    setConflictAction(null);
    setShowConflictModal(false);

    // Close modal immediately
    handleCloseModal();

    // Start simulated progress
    const interval = setInterval(() => {
      updateTransferProgress(transferId, Math.min(95, Math.random() * 15 + 5));
    }, 500);
    transferIntervalRef.current.set(transferId, interval);

    // Simulated progress increment
    let currentProgress = 0;
    const progressInterval = setInterval(() => {
      if (currentProgress >= 95) return;
      currentProgress += Math.random() * 15 + 5;
      currentProgress = Math.min(currentProgress, 95);
      updateTransferProgress(transferId, currentProgress);
    }, 500);
    transferIntervalRef.current.set(transferId, progressInterval);

    try {
      const token = getAuthToken();

      // Build source path
      const srcFullPath = savedSrcPath === '/'
        ? `/${savedFile.name}`
        : `${savedSrcPath}/${savedFile.name}`;

      // Build destination path (use finalFileName for rename)
      const dstFullPath = savedDstPath === '/'
        ? `/${finalFileName}`
        : `${savedDstPath}/${finalFileName}`;

      let response: Response;

      if (isCloudProvider(savedSrcConn.type)) {
        // Cloud providers use rclone
        setTransferStatus(transferId, `${isMove ? 'Movendo' : 'Copiando'} via cloud...`);
        const srcPath = savedSrcPath === '/' ? savedFile.name : `${savedSrcPath.substring(1)}/${savedFile.name}`;
        const dstPath = savedDstPath === '/' ? finalFileName : `${savedDstPath.substring(1)}/${finalFileName}`;
        const endpoint = isMove ? '/api/rclone/move' : '/api/rclone/copy';

        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            srcRemote: savedSrcConn.accountName,
            srcPath,
            dstRemote: savedDstConn.accountName || savedDstConn.name,
            dstPath,
            isDir: savedFile.type === 'folder'
          })
        });
      } else if (savedSrcConn.type === ConnectionType.SFTP && isSameConnection) {
        // SFTP copy/move within same server
        setTransferStatus(transferId, `${isMove ? 'Movendo' : 'Copiando'} via SFTP...`);
        response = await fetch(`/api/fs/sftp/${isMove ? 'rename' : 'copy'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            host: savedSrcConn.host,
            port: savedSrcConn.port,
            connectionId: savedSrcConn.id,
            oldPath: srcFullPath,
            newPath: dstFullPath,
            srcPath: srcFullPath,
            dstPath: dstFullPath
          })
        });
      } else if (savedSrcConn.type === ConnectionType.FTP && isSameConnection) {
        if (!isMove) {
          throw new Error('Copiar não é suportado em conexões FTP. Use Mover.');
        }
        // FTP move within same server
        setTransferStatus(transferId, 'Movendo via FTP...');
        response = await fetch('/api/fs/ftp/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            host: savedSrcConn.host,
            port: savedSrcConn.port,
            connectionId: savedSrcConn.id,
            oldPath: srcFullPath,
            newPath: dstFullPath
          })
        });
      } else if (savedSrcConn.type === ConnectionType.S3 && isSameConnection) {
        // S3 copy/move within same bucket
        setTransferStatus(transferId, `${isMove ? 'Movendo' : 'Copiando'} via S3...`);
        const srcKey = savedSrcPath === '/' ? savedFile.name : `${savedSrcPath.substring(1)}/${savedFile.name}`;
        const dstKey = savedDstPath === '/' ? finalFileName : `${savedDstPath.substring(1)}/${finalFileName}`;
        response = await fetch(`/api/fs/s3/${isMove ? 'rename' : 'copy'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            host: savedSrcConn.host,
            bucket: savedSrcConn.bucket,
            connectionId: savedSrcConn.id,
            region: savedSrcConn.region,
            oldKey: srcKey,
            newKey: dstKey,
            srcKey,
            dstKey
          })
        });
      } else {
        // Cross-server copy/move - use transfer endpoint
        setTransferStatus(transferId, 'Transferindo entre servidores...');
        response = await fetch('/api/fs/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            srcConnection: {
              id: savedSrcConn.id,
              type: savedSrcConn.type,
              host: savedSrcConn.host,
              port: savedSrcConn.port,
              bucket: savedSrcConn.bucket,
              region: savedSrcConn.region,
              share: savedSrcConn.share,
              mountPoint: savedSrcConn.mountPoint,
              accountName: savedSrcConn.accountName
            },
            dstConnection: {
              id: savedDstConn.id,
              type: savedDstConn.type,
              host: savedDstConn.host,
              port: savedDstConn.port,
              bucket: savedDstConn.bucket,
              region: savedDstConn.region,
              share: savedDstConn.share,
              mountPoint: savedDstConn.mountPoint,
              accountName: savedDstConn.accountName
            },
            srcPath: srcFullPath,
            dstPath: dstFullPath,
            fileName: finalFileName,
            isMove,
            isDir: savedFile.type === 'folder'
          })
        });
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Erro ao ${isMove ? 'mover' : 'copiar'}`);
      }

      // Refresh files
      if (savedSrcConn) {
        const data = await getFilesForConnection(savedSrcConn, savedSrcPath);
        setFiles(data);
        onFilesChange?.(data);
      }

      // Success - clear interval and complete transfer
      const interval = transferIntervalRef.current.get(transferId);
      if (interval) {
        clearInterval(interval);
        transferIntervalRef.current.delete(transferId);
      }
      completeTransfer(transferId);
    } catch (error: any) {
      console.error(`${isMove ? 'Move' : 'Copy'} error:`, error);
      const interval = transferIntervalRef.current.get(transferId);
      if (interval) {
        clearInterval(interval);
        transferIntervalRef.current.delete(transferId);
      }
      setTransferFailed(transferId, error.message);
    } finally {
      setOperationLoading(false);
    }
  };

  // --- Rename Logic ---
  const handleStartRename = (e: React.MouseEvent, file: FileItem) => {
    e.stopPropagation();
    setRenamingId(file.id);
    setRenameValue(file.name);
    setActiveMenuId(null);
  };

  const handleSaveRename = async () => {
    if (!renamingId || !renameValue.trim() || !activeConnection) {
      setRenamingId(null);
      return;
    }

    const file = files.find(f => f.id === renamingId);
    if (!file) {
      setRenamingId(null);
      return;
    }

    // Don't call API if name hasn't changed
    if (file.name === renameValue.trim()) {
      setRenamingId(null);
      return;
    }

    setOperationLoading(true);
    try {
      const token = getAuthToken();
      let response;

      if (isCloudProvider(activeConnection.type)) {
        // Cloud providers use rclone
        if (!activeConnection.accountName) {
          throw new Error('Conexão cloud não configurada');
        }
        const oldPath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
        const newPath = currentPath === '/' ? renameValue.trim() : `${currentPath.substring(1)}/${renameValue.trim()}`;

        response = await fetch('/api/rclone/rename', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            remote: activeConnection.accountName,
            oldPath: oldPath,
            newPath: newPath,
            isDir: file.type === 'folder'
          })
        });
      } else if (activeConnection.type === ConnectionType.SFTP) {
        const oldFullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        const newFullPath = currentPath === '/' ? `/${renameValue.trim()}` : `${currentPath}/${renameValue.trim()}`;
        response = await fetch('/api/fs/sftp/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, port: activeConnection.port, connectionId: activeConnection.id, oldPath: oldFullPath, newPath: newFullPath })
        });
      } else if (activeConnection.type === ConnectionType.FTP) {
        const oldFullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        const newFullPath = currentPath === '/' ? `/${renameValue.trim()}` : `${currentPath}/${renameValue.trim()}`;
        response = await fetch('/api/fs/ftp/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, port: activeConnection.port, connectionId: activeConnection.id, oldPath: oldFullPath, newPath: newFullPath })
        });
      } else if (activeConnection.type === ConnectionType.SMB) {
        const oldFullPath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
        const newFullPath = currentPath === '/' ? renameValue.trim() : `${currentPath.substring(1)}/${renameValue.trim()}`;
        response = await fetch('/api/fs/smb/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, share: activeConnection.share, connectionId: activeConnection.id, oldPath: oldFullPath, newPath: newFullPath })
        });
      } else if (activeConnection.type === ConnectionType.NFS) {
        const oldFullPath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
        const newFullPath = currentPath === '/' ? renameValue.trim() : `${currentPath.substring(1)}/${renameValue.trim()}`;
        response = await fetch('/api/fs/nfs/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ mountPoint: activeConnection.mountPoint, oldPath: oldFullPath, newPath: newFullPath })
        });
      } else if (activeConnection.type === ConnectionType.S3) {
        const oldKey = file.s3Key || (currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`);
        const newKey = currentPath === '/' ? renameValue.trim() : `${currentPath.substring(1)}/${renameValue.trim()}`;
        response = await fetch('/api/fs/s3/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, bucket: activeConnection.bucket, connectionId: activeConnection.id, region: activeConnection.region, oldKey, newKey })
        });
      } else {
        throw new Error(`Renomear não suportado para ${activeConnection.type}`);
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao renomear');
      }

      // Update local state
      setFiles(prev => prev.map(f => f.id === renamingId ? { ...f, name: renameValue.trim() } : f));
    } catch (error: any) {
      console.error('Rename error:', error);
      alert(`Erro ao renomear: ${error.message}`);
    } finally {
      setOperationLoading(false);
      setRenamingId(null);
    }
  };

  const handleCancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  // --- Create Folder Logic ---

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !activeConnection) return;

    setOperationLoading(true);
    try {
      const token = getAuthToken();
      let response;

      if (isCloudProvider(activeConnection.type)) {
        // Cloud providers use rclone
        if (!activeConnection.accountName) {
          throw new Error('Conexão cloud não configurada');
        }
        const folderPath = currentPath === '/'
          ? newFolderName.trim()
          : `${currentPath.substring(1)}/${newFolderName.trim()}`;

        response = await fetch('/api/rclone/mkdir', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            remote: activeConnection.accountName,
            path: folderPath
          })
        });
      } else if (activeConnection.type === ConnectionType.SFTP) {
        const fullPath = currentPath === '/' ? `/${newFolderName.trim()}` : `${currentPath}/${newFolderName.trim()}`;
        response = await fetch('/api/fs/sftp/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, port: activeConnection.port, connectionId: activeConnection.id, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.FTP) {
        const fullPath = currentPath === '/' ? `/${newFolderName.trim()}` : `${currentPath}/${newFolderName.trim()}`;
        response = await fetch('/api/fs/ftp/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, port: activeConnection.port, connectionId: activeConnection.id, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.SMB) {
        const fullPath = currentPath === '/' ? newFolderName.trim() : `${currentPath.substring(1)}/${newFolderName.trim()}`;
        response = await fetch('/api/fs/smb/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, share: activeConnection.share, connectionId: activeConnection.id, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.NFS) {
        const fullPath = currentPath === '/' ? newFolderName.trim() : `${currentPath.substring(1)}/${newFolderName.trim()}`;
        response = await fetch('/api/fs/nfs/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ mountPoint: activeConnection.mountPoint, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.S3) {
        const fullPath = currentPath === '/' ? newFolderName.trim() : `${currentPath.substring(1)}/${newFolderName.trim()}`;
        response = await fetch('/api/fs/s3/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, bucket: activeConnection.bucket, connectionId: activeConnection.id, region: activeConnection.region, path: fullPath })
        });
      } else {
        throw new Error(`Criar pasta não suportado para ${activeConnection.type}`);
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao criar pasta');
      }

      // Add to local state
      const newFolder: FileItem = {
        id: `folder-${Date.now()}`,
        name: newFolderName.trim(),
        type: 'folder',
        size: 0,
        modifiedAt: new Date().toISOString(),
        parentId: null,
        path: currentPath,
        connectionId: activeConnection?.id,
        connectionName: activeConnection?.name
      };

      setFiles(prev => [newFolder, ...prev]);
      setNewFolderName('');
      setIsCreatingFolder(false);
    } catch (error: any) {
      console.error('Create folder error:', error);
      alert(`Erro ao criar pasta: ${error.message}`);
    } finally {
      setOperationLoading(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFileName, setUploadFileName] = useState('');

  const handleUploadClick = () => {
    if (!activeConnection) {
      alert('Selecione uma conexão primeiro');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConnection) return;

    // Check if this is a retry after conflict resolution (file === pendingUploadFile)
    const isRetry = pendingUploadFile && file === pendingUploadFile;

    // Check if file already exists in current directory (only on first attempt)
    if (!isRetry) {
      const fileNameToCheck = uploadConflictAction === 'rename' ? uploadRenameValue : file.name;
      const existsInDir = files.some(f => f.name.toLowerCase() === fileNameToCheck.toLowerCase() && f.type === 'file');

      // If exists and no action chosen yet, show conflict modal
      if (existsInDir && !uploadConflictAction) {
        setPendingUploadFile(file);
        setUploadRenameValue(file.name);
        setShowConflictModal(true);
        setConflictFileName(file.name);
        // Reset input
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }

    const token = getAuthToken();
    if (!token) {
      alert('Sessão expirada. Por favor, faça login novamente.');
      return;
    }

    const finalFileName = uploadConflictAction === 'rename' ? uploadRenameValue : file.name;

    // Save current path and connection at upload time
    const uploadPath = currentPath;
    const uploadConnection = activeConnection;

    setUploading(true);
    setUploadProgress(0);
    setUploadFileName(finalFileName);

    const formData = new FormData();
    // Rename file if needed
    if (uploadConflictAction === 'rename') {
      const renamedFile = new File([file], finalFileName, { type: file.type });
      formData.append('file', renamedFile);
    } else {
      formData.append('file', file);
    }

    let uploadUrl: string;

    try {
      if (isCloudProvider(activeConnection.type)) {
        if (!activeConnection.accountName) {
          throw new Error('Conexão cloud não configurada');
        }
        uploadUrl = '/api/rclone/upload';
        formData.append('remote', activeConnection.accountName);
        const remotePath = currentPath === '/' ? '' : currentPath.substring(1);
        formData.append('remotePath', remotePath);
      } else if (activeConnection.type === ConnectionType.SFTP) {
        uploadUrl = '/api/fs/sftp/upload';
        formData.append('host', activeConnection.host || '');
        formData.append('port', String(activeConnection.port || 22));
        formData.append('connectionId', activeConnection.id);
        formData.append('remotePath', currentPath);
      } else if (activeConnection.type === ConnectionType.FTP) {
        uploadUrl = '/api/fs/ftp/upload';
        formData.append('host', activeConnection.host || '');
        formData.append('port', String(activeConnection.port || 21));
        formData.append('connectionId', activeConnection.id);
        formData.append('remotePath', currentPath);
      } else if (activeConnection.type === ConnectionType.SMB) {
        uploadUrl = '/api/fs/smb/upload';
        formData.append('host', activeConnection.host || '');
        formData.append('share', activeConnection.share || '');
        formData.append('connectionId', activeConnection.id);
        formData.append('remotePath', currentPath === '/' ? '' : currentPath.substring(1));
      } else if (activeConnection.type === ConnectionType.NFS) {
        uploadUrl = '/api/fs/nfs/upload';
        formData.append('mountPoint', activeConnection.mountPoint || '');
        formData.append('remotePath', currentPath === '/' ? '' : currentPath.substring(1));
      } else if (activeConnection.type === ConnectionType.S3) {
        uploadUrl = '/api/fs/s3/upload';
        formData.append('host', activeConnection.host || '');
        formData.append('bucket', activeConnection.bucket || '');
        formData.append('connectionId', activeConnection.id);
        formData.append('region', activeConnection.region || 'us-east-1');
        formData.append('prefix', currentPath === '/' ? '' : currentPath.substring(1) + '/');
      } else {
        throw new Error(`Upload não suportado para ${activeConnection.type}`);
      }
    } catch (error: any) {
      console.error('Upload setup error:', error);
      alert(`Erro ao configurar upload: ${error.message}`);
      setUploading(false);
      setUploadProgress(0);
      setUploadFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Use XMLHttpRequest for progress tracking
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(progress);
      }
    });

    xhr.addEventListener('load', async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          setUploadProgress(100);

          // Reload files from server only if still in the same path/connection where upload was initiated
          if (activeConnection?.id === uploadConnection?.id && currentPath === uploadPath) {
            const data = await getFilesForConnection(uploadConnection, uploadPath);
            setFiles(data);
            onFilesChange?.(data);
          }

          // Hide progress after success
          setTimeout(() => {
            setUploading(false);
            setUploadProgress(0);
            setUploadFileName('');
            // Reset upload conflict states
            setUploadConflictAction(null);
            setPendingUploadFile(null);
            setUploadRenameValue('');
          }, 1500);
        } catch (parseError) {
          console.error('Error parsing upload response:', parseError);
          alert('Erro ao processar resposta do servidor');
          setUploading(false);
          setUploadProgress(0);
          setUploadFileName('');
          setUploadConflictAction(null);
          setPendingUploadFile(null);
        }
      } else {
        let errorMsg = 'Erro ao enviar arquivo';
        try {
          const response = JSON.parse(xhr.responseText);
          errorMsg = response.error || errorMsg;
        } catch {}
        console.error('Upload failed:', errorMsg);
        alert(`Erro ao enviar: ${errorMsg}`);
        setUploading(false);
        setUploadProgress(0);
        setUploadFileName('');
        setUploadConflictAction(null);
        setPendingUploadFile(null);
      }
    });

    xhr.addEventListener('error', () => {
      console.error('Network error during upload');
      alert('Erro de rede ao enviar arquivo');
      setUploading(false);
      setUploadProgress(0);
      setUploadFileName('');
      setUploadConflictAction(null);
      setPendingUploadFile(null);
    });

    xhr.addEventListener('abort', () => {
      console.log('Upload aborted');
      setUploading(false);
      setUploadProgress(0);
      setUploadFileName('');
      setUploadConflictAction(null);
      setPendingUploadFile(null);
    });

    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Get current folder contents for destination browser
  const getDestFolderContents = () => {
    return destFiles.filter(f =>
      f.type === 'folder' &&
      // Prevent moving folder into itself
      (actionType !== 'move' || f.id !== targetActionFile?.id)
    );
  };

  // Files are now loaded for the current path from server, just filter by search
  const filteredFiles = files.filter(f =>
    f.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getIcon = (file: FileItem) => {
    if (file.type === 'folder') return <Folder className="text-yellow-500 fill-yellow-500/20" size={24} />;
    if (file.mimeType?.startsWith('image')) return <FileImage className="text-purple-400" size={24} />;
    return <FileText className="text-blue-400" size={24} />;
  };

  // Parse current path into breadcrumb parts
  const getBreadcrumbParts = () => {
    if (currentPath === '/') return [];
    return currentPath.split('/').filter(Boolean);
  };

  // Navigate to a specific path level
  const navigateToPathLevel = (index: number) => {
    const parts = getBreadcrumbParts();
    const newPath = '/' + parts.slice(0, index + 1).join('/');
    setCurrentPath(newPath);
  };

  // Go to parent directory
  const goToParent = () => {
    if (currentPath === '/') return;
    const parts = getBreadcrumbParts();
    parts.pop();
    const newPath = parts.length === 0 ? '/' : '/' + parts.join('/');
    setCurrentPath(newPath);
  };

  if (!activeConnection) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500">
        <div className="bg-slate-800 p-6 rounded-full mb-4">
          <Search size={48} className="text-slate-600" />
        </div>
        <p className="text-lg">Selecione uma conexão para explorar arquivos</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950/50 relative">
      {/* Toolbar */}
      <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2 text-sm text-slate-400">
           {/* Back button */}
           <button
             onClick={goToParent}
             disabled={currentPath === '/'}
             className={`p-1.5 rounded-lg transition-colors ${currentPath === '/' ? 'text-slate-600 cursor-not-allowed' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
             title="Voltar ao diretório pai"
           >
             <ArrowUp size={16} />
           </button>

           <span
             className="font-semibold text-primary-400 cursor-pointer hover:underline flex items-center gap-1"
             onClick={() => setCurrentPath('/')}
           >
             <Server size={14} />
             {activeConnection.name}
           </span>
           <ChevronRight size={16} />
           <span
             className={`cursor-pointer ${currentPath === '/' ? 'text-white font-bold' : 'text-slate-300 hover:underline'}`}
             onClick={() => setCurrentPath('/')}
           >root</span>
           {getBreadcrumbParts().map((part, index) => (
             <React.Fragment key={index}>
               <ChevronRight size={16} />
               <span
                 className={`cursor-pointer ${index === getBreadcrumbParts().length - 1 ? 'text-white font-bold' : 'text-slate-300 hover:underline'}`}
                 onClick={() => navigateToPathLevel(index)}
               >
                 {part}
               </span>
             </React.Fragment>
           ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input 
              type="text" 
              placeholder="Buscar arquivos..." 
              className="bg-slate-800 border border-slate-700 text-sm rounded-lg pl-9 pr-4 py-2 text-white placeholder-slate-500 focus:ring-2 focus:ring-primary-500 focus:outline-none w-64"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
            <button 
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              <Filter size={18} className="rotate-90" />
            </button>
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              <div className="grid grid-cols-2 gap-0.5">
                <div className="w-2 h-2 bg-current rounded-[1px]" />
                <div className="w-2 h-2 bg-current rounded-[1px]" />
                <div className="w-2 h-2 bg-current rounded-[1px]" />
                <div className="w-2 h-2 bg-current rounded-[1px]" />
              </div>
            </button>
          </div>
          
          <button 
            onClick={() => setIsCreatingFolder(true)}
            className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors border border-slate-700"
          >
            <FolderPlus size={18} />
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={handleUploadClick}
            disabled={uploading || !activeConnection}
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <UploadCloud size={18} />}
            <span>{uploading ? `${uploadProgress}%` : 'Upload'}</span>
          </button>
        </div>
      </div>

      {/* Upload Progress Bar */}
      {uploading && (
        <div className="fixed bottom-24 right-4 z-50 bg-slate-800 border border-slate-700 p-4 rounded-xl shadow-2xl min-w-[380px] max-w-[450px] animate-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <UploadCloud size={20} className="text-green-400" />
              <span className="text-white font-medium">Enviando arquivo...</span>
            </div>
          </div>

          <div className="mb-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 w-14">Arquivo:</span>
              <span className="text-slate-300 truncate flex-1" title={uploadFileName}>{uploadFileName}</span>
            </div>
          </div>

          <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{Math.round(uploadProgress)}% concluído</span>
          </div>
        </div>
      )}
      
      {/* New Folder Input Modal */}
      {isCreatingFolder && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 bg-slate-800 border border-slate-700 p-4 rounded-xl shadow-2xl flex items-center gap-2 animate-in slide-in-from-top-2">
          <Folder size={20} className="text-yellow-500" />
          <input
            autoFocus
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Nome da pasta"
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm outline-none focus:border-primary-500"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
          />
          <button onClick={handleCreateFolder} className="p-1 text-green-400 hover:bg-slate-700 rounded"><Check size={18} /></button>
          <button onClick={() => setIsCreatingFolder(false)} className="p-1 text-red-400 hover:bg-slate-700 rounded"><X size={18} /></button>
        </div>
      )}

      {/* Download Progress Bar */}
      {downloading && (
        <div className={`fixed bottom-24 right-4 z-50 bg-slate-800 border ${downloadFailed ? 'border-red-500/50' : 'border-slate-700'} p-4 rounded-xl shadow-2xl min-w-[380px] max-w-[450px] animate-in slide-in-from-bottom-2`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {downloadFailed ? (
                <AlertCircle size={20} className="text-red-400" />
              ) : (
                <Download size={20} className="text-primary-400" />
              )}
              <span className="text-white font-medium">
                {downloadFailed ? 'Falha no download' : 'Baixando arquivo...'}
              </span>
            </div>
            {!downloadFailed && (
              <button onClick={handleCancelDownload} className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded" title="Cancelar">
                <X size={18} />
              </button>
            )}
          </div>

          <div className="mb-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 w-14">Arquivo:</span>
              <span className="text-slate-300 truncate flex-1" title={downloadFileName}>{downloadFileName}</span>
            </div>
          </div>

          <div className={`w-full ${downloadFailed ? 'bg-red-900/30' : 'bg-slate-700'} rounded-full h-2.5 overflow-hidden mb-2`}>
            {downloadFailed ? (
              <div className="h-full bg-red-500 w-full" />
            ) : downloadProgress === -1 ? (
              <div className="h-full bg-gradient-to-r from-primary-500 to-blue-500 animate-pulse w-full" />
            ) : (
              <div className="h-full bg-gradient-to-r from-primary-500 to-blue-500 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
            )}
          </div>

          {!downloadFailed && (
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{downloadProgress === -1 ? 'Calculando...' : `${Math.round(downloadProgress)}% concluído`}</span>
            </div>
          )}

          {downloadFailed && (
            <>
              <p className="text-xs text-red-400 mb-2">Erro ao baixar o arquivo</p>
              <div className="flex gap-2 mt-3">
                <button onClick={handleRetryDownload} className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white text-sm rounded-lg">
                  <RefreshCw size={14} /> Repetir
                </button>
                <button onClick={handleDismissDownload} className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg">
                  <X size={14} /> Fechar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Conflict Resolution Modal */}
      {showConflictModal && (
        <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 w-full max-w-md border border-yellow-500/30 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 bg-yellow-500/10">
              <div className="flex items-center gap-3">
                <AlertCircle size={24} className="text-yellow-500" />
                <div>
                  <h3 className="font-semibold text-white">Arquivo já existe</h3>
                  <p className="text-xs text-slate-400 mt-1">"{conflictFileName}" já existe no destino</p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-300">
                Como deseja proceder?
              </p>

              {/* Replace Option */}
              <button
                onClick={() => {
                  if (pendingUploadFile) {
                    // Upload conflict
                    setUploadConflictAction('replace');
                    setShowConflictModal(false);
                    // Trigger upload with replace action
                    const fakeEvent = { target: { files: [pendingUploadFile] } } as any;
                    setTimeout(() => handleFileSelect(fakeEvent), 100);
                  } else {
                    // Copy/Move conflict
                    setConflictAction('replace');
                    setShowConflictModal(false);
                    setTimeout(() => handleConfirmAction(), 100);
                  }
                }}
                className="w-full p-4 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-left transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center group-hover:bg-red-500/30 transition-colors">
                    <X size={20} className="text-red-400" />
                  </div>
                  <div>
                    <p className="font-medium text-white">Substituir</p>
                    <p className="text-xs text-slate-400">O arquivo existente será sobrescrito</p>
                  </div>
                </div>
              </button>

              {/* Rename Option */}
              <div className="space-y-2">
                <button
                  onClick={() => {
                    if (pendingUploadFile) {
                      setUploadConflictAction('rename');
                    } else {
                      setConflictAction('rename');
                    }
                  }}
                  className={`w-full p-4 ${(conflictAction === 'rename' || uploadConflictAction === 'rename') ? 'bg-primary-500/20 border-primary-500/50' : 'bg-slate-800/50 border-slate-700'} border rounded-lg text-left transition-colors group hover:bg-primary-500/10`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full ${(conflictAction === 'rename' || uploadConflictAction === 'rename') ? 'bg-primary-500/30' : 'bg-slate-700'} flex items-center justify-center transition-colors`}>
                      <Edit size={20} className="text-primary-400" />
                    </div>
                    <div>
                      <p className="font-medium text-white">Renomear</p>
                      <p className="text-xs text-slate-400">Salvar com um nome diferente</p>
                    </div>
                  </div>
                </button>

                {(conflictAction === 'rename' || uploadConflictAction === 'rename') && (
                  <div className="pl-14 animate-in slide-in-from-top-2">
                    <input
                      type="text"
                      value={pendingUploadFile ? uploadRenameValue : conflictRenameValue}
                      onChange={(e) => {
                        if (pendingUploadFile) {
                          setUploadRenameValue(e.target.value);
                        } else {
                          setConflictRenameValue(e.target.value);
                        }
                      }}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm outline-none focus:border-primary-500 transition-colors"
                      placeholder="Novo nome"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowConflictModal(false);
                  setConflictAction(null);
                  setUploadConflictAction(null);
                  setPendingUploadFile(null);
                }}
                className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
              >
                Cancelar
              </button>
              {(conflictAction === 'rename' || uploadConflictAction === 'rename') && (
                <button
                  onClick={() => {
                    const renameVal = pendingUploadFile ? uploadRenameValue : conflictRenameValue;
                    if (!renameVal.trim()) {
                      alert('Por favor, insira um nome válido');
                      return;
                    }
                    setShowConflictModal(false);
                    if (pendingUploadFile) {
                      // Upload with rename
                      const fakeEvent = { target: { files: [pendingUploadFile] } } as any;
                      setTimeout(() => handleFileSelect(fakeEvent), 100);
                    } else {
                      // Copy/Move with rename
                      setTimeout(() => handleConfirmAction(), 100);
                    }
                  }}
                  disabled={!(pendingUploadFile ? uploadRenameValue : conflictRenameValue).trim()}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continuar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Universal Action Modal (Move / Copy) */}
      {targetActionFile && !showConflictModal && (
        <div className="absolute inset-0 z-30 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 w-full max-w-lg border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[80vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
              <div>
                <h3 className="font-medium text-white flex items-center gap-2 text-lg">
                  {actionType === 'move' ? <FolderInput className="text-primary-400" /> : <Copy className="text-primary-400" />}
                  {actionType === 'move' ? 'Mover' : 'Copiar'} "{targetActionFile.name}"
                </h3>
                <p className="text-xs text-slate-400 mt-1">Selecione o destino abaixo</p>
              </div>
              <button onClick={handleCloseModal} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {/* Browser Area */}
            <div className="flex-1 overflow-y-auto bg-slate-950 p-2">
              {/* Breadcrumbs inside modal */}
              <div className="px-2 py-2 text-sm text-slate-400 flex items-center gap-1 mb-2 border-b border-slate-800/50">
                 <button 
                   onClick={() => { setDestConnection(null); setDestPath('/'); }}
                   className={`hover:text-white ${!destConnection ? 'font-bold text-white' : ''}`}
                 >
                   Conexões
                 </button>
                 {destConnection && (
                   <>
                     <ChevronRight size={14} />
                     <button
                       onClick={() => setDestPath(destConnection.defaultPath || '/')}
                       className={`hover:text-white ${destPath === (destConnection.defaultPath || '/') ? 'font-bold text-white' : ''}`}
                     >
                       {destConnection.name}
                     </button>
                   </>
                 )}
                 {destConnection && destPath !== (destConnection.defaultPath || '/') && (
                   <>
                     <ChevronRight size={14} />
                     <span className="text-white font-bold truncate max-w-[150px]">{destPath.replace('/', '')}</span>
                   </>
                 )}
              </div>

              {/* List Content */}
              <div className="space-y-1">
                {!destConnection ? (
                   // Level 1: List Connections
                   connections.map(conn => (
                     <button
                       key={conn.id}
                       onClick={() => {
                         setDestConnection(conn);
                         setDestPath(conn.defaultPath || '/');
                       }}
                       className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                     >
                       <Globe size={18} className="text-blue-400" />
                       <span className="font-medium">{conn.name}</span>
                       <span className="text-xs ml-auto bg-slate-800 px-2 py-0.5 rounded text-slate-500">{conn.type}</span>
                     </button>
                   ))
                ) : destLoading ? (
                   <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-500" /></div>
                ) : (
                   // Level 2: List Folders
                   <>
                     {/* Option to select current root */}
                     <button
                       onClick={() => {/* Already selected by being here */}}
                       className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 border border-transparent ${destPath === (destConnection.defaultPath || '/') ? 'bg-slate-800/50 border-primary-500/30 text-white' : 'text-slate-400'}`}
                     >
                        <Folder size={18} className="text-slate-500" />
                        <span className="italic text-sm">Pasta Raiz ({destConnection.defaultPath || '/'})</span>
                     </button>

                     {getDestFolderContents().map(folder => (
                       <button 
                         key={folder.id}
                         onClick={() => setDestPath(folder.path === '/' ? `/${folder.name}` : `${folder.path}/${folder.name}`)}
                         className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                       >
                          <Folder size={18} className="text-yellow-500" />
                          <span>{folder.name}</span>
                       </button>
                     ))}
                     
                     {getDestFolderContents().length === 0 && (
                       <div className="text-center py-4 text-xs text-slate-600">Nenhuma subpasta aqui.</div>
                     )}
                   </>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end gap-3">
              <button onClick={handleCloseModal} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Cancelar</button>
              <button
                onClick={handleConfirmAction}
                disabled={!destConnection}
                className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
              >
                {actionType === 'move' ? 'Mover Aqui' : 'Copiar Aqui'}
                <Check size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
           <div className="flex justify-center items-center h-64">
             <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
           </div>
        ) : (
          <>
            {viewMode === 'list' ? (
              <div className="min-w-full rounded-lg border border-slate-800 bg-slate-900/50 overflow-visible">
                <table className="w-full text-left text-sm text-slate-400">
                  <thead className="bg-slate-800/50 text-xs uppercase font-medium text-slate-300">
                    <tr>
                      <th className="px-6 py-3 w-12"></th>
                      <th className="px-6 py-3">Nome</th>
                      <th className="px-6 py-3">Tamanho</th>
                      <th className="px-6 py-3">Modificado</th>
                      <th className="px-6 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredFiles.map((file) => (
                      <tr
                        key={file.id}
                        className={`hover:bg-slate-800/50 transition-colors cursor-pointer group relative ${
                          selectedFileId === file.id ? 'bg-primary-500/20 border-l-2 border-primary-500' : ''
                        }`}
                        onClick={() => {
                          if(file.type === 'folder') {
                            // Navigate into folder
                            const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
                            setCurrentPath(newPath);
                          } else {
                            onPreview(file);
                          }
                          setSelectedFileId(null);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, file });
                          setSelectedFileId(file.id);
                          setActiveMenuId(null);
                        }}
                      >
                        <td className="px-6 py-4">{getIcon(file)}</td>
                        <td className="px-6 py-4 font-medium text-slate-200">
                          {renamingId === file.id ? (
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <input 
                                autoFocus
                                className="bg-slate-950 border border-primary-500 rounded px-2 py-1 text-white text-sm outline-none w-full"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if(e.key === 'Enter') handleSaveRename();
                                  if(e.key === 'Escape') handleCancelRename();
                                }}
                              />
                              <button onClick={handleSaveRename} className="text-green-400 hover:text-green-300"><Check size={16}/></button>
                              <button onClick={handleCancelRename} className="text-red-400 hover:text-red-300"><X size={16}/></button>
                            </div>
                          ) : (
                            file.name
                          )}
                        </td>
                        <td className="px-6 py-4">{formatSize(file.size)}</td>
                        <td className="px-6 py-4">{new Date(file.modifiedAt).toLocaleString()}</td>
                        <td className="px-6 py-4 text-right relative">
                           <button 
                             onClick={(e) => handleMenuClick(e, file.id)}
                             className={`p-2 rounded-lg hover:bg-slate-700 transition-all ${activeMenuId === file.id ? 'opacity-100 bg-slate-700 text-white' : 'text-slate-500 opacity-0 group-hover:opacity-100'}`}
                           >
                             <MoreVertical size={18} />
                           </button>
                           
                           {/* Dropdown Menu */}
                           {activeMenuId === file.id && (
                             <div ref={menuRef} className="absolute right-8 top-8 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                               {file.type !== 'folder' && (
                                 <button onClick={(e) => { e.stopPropagation(); setActiveMenuId(null); onPreview(file); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                                   <Eye size={14} /> Visualizar
                                 </button>
                               )}
                               <button onClick={(e) => handleStartRename(e, file)} className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                                 <Edit size={14} /> Renomear
                               </button>
                               <button onClick={(e) => handleInitiateCopy(e, file)} className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                                 <Copy size={14} /> Copiar para...
                               </button>
                               <button onClick={(e) => handleInitiateMove(e, file)} className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                                 <FolderInput size={14} /> Mover para...
                               </button>
                               <button onClick={(e) => handleDownload(e, file)} className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                                 <Download size={14} /> Baixar
                               </button>
                               <button onClick={(e) => handleShare(e, file)} className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                                 <Link size={14} /> Compartilhar
                               </button>
                               <div className="h-px bg-slate-700 my-1"></div>
                               <button onClick={(e) => handleDelete(e, file)} className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2">
                                 <Trash2 size={14} /> Excluir
                               </button>
                             </div>
                           )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredFiles.length === 0 && (
                   <div className="p-12 text-center text-slate-500">Pasta vazia ou nenhum arquivo encontrado.</div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredFiles.map((file) => (
                  <div
                    key={file.id}
                    onClick={() => {
                      if(file.type === 'folder') {
                        const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
                        setCurrentPath(newPath);
                      } else {
                        onPreview(file);
                      }
                      setSelectedFileId(null);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, file });
                      setSelectedFileId(file.id);
                      setActiveMenuId(null);
                    }}
                    className={`bg-slate-900 border hover:border-primary-500/50 hover:bg-slate-800 rounded-xl p-4 flex flex-col items-center gap-3 cursor-pointer transition-all group relative ${
                      selectedFileId === file.id ? 'border-primary-500 bg-primary-500/10' : 'border-slate-800'
                    }`}
                  >
                    {/* Grid Actions */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                         onClick={(e) => handleMenuClick(e, file.id)}
                         className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 border border-slate-700"
                       >
                        <MoreVertical size={14} />
                      </button>
                      {activeMenuId === file.id && (
                         <div ref={menuRef} className="absolute right-0 top-8 w-44 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
                           {file.type !== 'folder' && (
                             <button onClick={(e) => { e.stopPropagation(); setActiveMenuId(null); onPreview(file); }} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                               <Eye size={12} /> Visualizar
                             </button>
                           )}
                           <button onClick={(e) => handleStartRename(e, file)} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                             <Edit size={12} /> Renomear
                           </button>
                           <button onClick={(e) => handleInitiateCopy(e, file)} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                             <Copy size={12} /> Copiar para...
                           </button>
                           <button onClick={(e) => handleInitiateMove(e, file)} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                             <FolderInput size={12} /> Mover para...
                           </button>
                           <button onClick={(e) => handleDownload(e, file)} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                             <Download size={12} /> Baixar
                           </button>
                           <button onClick={(e) => handleShare(e, file)} className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2">
                             <Link size={12} /> Compartilhar
                           </button>
                           <button onClick={(e) => handleDelete(e, file)} className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2">
                             <Trash2 size={12} /> Excluir
                           </button>
                         </div>
                       )}
                    </div>

                    <div className="p-4 bg-slate-950 rounded-lg group-hover:scale-105 transition-transform">
                      {getIcon(file)}
                    </div>
                    <div className="text-center w-full relative">
                      {renamingId === file.id ? (
                         <input 
                            autoFocus
                            className="bg-slate-950 border border-primary-500 rounded px-1 py-0.5 text-white text-xs outline-none w-full text-center"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if(e.key === 'Enter') handleSaveRename();
                              if(e.key === 'Escape') handleCancelRename();
                            }}
                            onBlur={handleCancelRename}
                          />
                      ) : (
                        <>
                          <p className="text-sm font-medium text-slate-200 truncate w-full" title={file.name}>{file.name}</p>
                          <p className="text-xs text-slate-500 mt-1">{formatSize(file.size)}</p>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete Notification */}
      {deleteNotification && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-4 min-w-[400px] animate-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <Trash2 size={18} className="text-red-400" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">"{deleteNotification.file.name}" foi excluído</p>
                <p className="text-slate-400 text-xs mt-0.5">A exclusão será permanente em 5 segundos</p>
              </div>
            </div>
            <button
              onClick={handleUndoDelete}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              <RefreshCw size={14} />
              Desfazer
            </button>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-slate-800 border border-slate-700 rounded-lg shadow-2xl z-[9999] overflow-hidden animate-in fade-in zoom-in-95 duration-100 min-w-[200px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.file.type !== 'folder' && (
            <button
              onClick={() => {
                setContextMenu(null);
                onPreview(contextMenu.file);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
            >
              <Eye size={14} /> Visualizar
            </button>
          )}
          <button
            onClick={() => {
              setContextMenu(null);
              handleStartRename({ stopPropagation: () => {} } as any, contextMenu.file);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
          >
            <Edit size={14} /> Renomear
          </button>
          <button
            onClick={() => {
              setContextMenu(null);
              handleInitiateCopy({ stopPropagation: () => {} } as any, contextMenu.file);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
          >
            <Copy size={14} /> Copiar para...
          </button>
          <button
            onClick={() => {
              setContextMenu(null);
              handleInitiateMove({ stopPropagation: () => {} } as any, contextMenu.file);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
          >
            <FolderInput size={14} /> Mover para...
          </button>
          <button
            onClick={() => {
              setContextMenu(null);
              handleDownload({ stopPropagation: () => {} } as any, contextMenu.file);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
          >
            <Download size={14} /> Baixar
          </button>
          <button
            onClick={() => {
              setContextMenu(null);
              handleShare({ stopPropagation: () => {} } as any, contextMenu.file);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors"
          >
            <Link size={14} /> Compartilhar
          </button>
          <div className="h-px bg-slate-700 my-1"></div>
          <button
            onClick={() => {
              setContextMenu(null);
              handleDelete({ stopPropagation: () => {} } as any, contextMenu.file);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
          >
            <Trash2 size={14} /> Excluir
          </button>
        </div>
      )}
    </div>
  );
};

export default FileExplorer;
