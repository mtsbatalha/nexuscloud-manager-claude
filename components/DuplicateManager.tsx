import React, { useState } from 'react';
import { Sparkles, Trash2, ArrowRight, CheckCircle, AlertCircle, ScanLine, HardDrive, Loader2 } from 'lucide-react';
import { FileItem, DuplicateCandidate, Connection, ConnectionType } from '../types';
import { getFilesForConnection } from '../services/mockData';
import { detectDuplicatesWithAI } from '../services/gemini';

const getAuthToken = () => localStorage.getItem('nexus_token');

const isCloudProvider = (type?: ConnectionType) => {
  return type === ConnectionType.GDRIVE || type === ConnectionType.DROPBOX || type === ConnectionType.ONEDRIVE;
};

interface DuplicateManagerProps {
  connections?: Connection[];
}

const DuplicateManager: React.FC<DuplicateManagerProps> = ({ connections = [] }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [scanned, setScanned] = useState(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [totalSavings, setTotalSavings] = useState(0);

  const handleScan = async () => {
    setIsScanning(true);
    setScanned(false);
    setCandidates([]);
    setDeletedIds(new Set());
    setTotalSavings(0);

    const connectedList = connections.filter(c => c.status === 'connected');
    let allFiles: FileItem[] = [];

    for (const conn of connectedList) {
      try {
        setScanProgress(`Escaneando ${conn.name}...`);
        const files = await getFilesForConnection(conn, '/');
        // Add connection info to files
        const filesWithConn = files.map(f => ({
          ...f,
          connectionId: conn.id,
          connectionName: conn.name,
          connectionType: conn.type
        }));
        allFiles = [...allFiles, ...filesWithConn];
      } catch (e) {
        console.error(`Error loading files from ${conn.name}:`, e);
      }
    }

    if (allFiles.length === 0) {
      setIsScanning(false);
      setScanned(true);
      setScanProgress('');
      return;
    }

    setScanProgress('Analisando com IA...');
    const results = await detectDuplicatesWithAI(allFiles);

    // Calculate potential savings
    const savings = results.reduce((acc, r) => {
      return acc + Math.min(r.fileA.size, r.fileB.size);
    }, 0);
    setTotalSavings(savings);

    setCandidates(results);
    setIsScanning(false);
    setScanned(true);
    setScanProgress('');
  };

  const handleMarkDelete = (id: string) => {
    setDeletedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleConfirmDelete = async () => {
    if (deletedIds.size === 0) return;

    setIsDeleting(true);
    const token = getAuthToken();
    if (!token) {
      alert('Sessão expirada');
      setIsDeleting(false);
      return;
    }

    // Get files to delete
    const filesToDelete: FileItem[] = [];
    for (const candidate of candidates) {
      if (deletedIds.has(candidate.fileA.id)) filesToDelete.push(candidate.fileA);
      if (deletedIds.has(candidate.fileB.id)) filesToDelete.push(candidate.fileB);
    }

    let deletedCount = 0;
    let errorCount = 0;

    for (const file of filesToDelete) {
      try {
        const conn = connections.find(c => c.id === file.connectionId);
        if (!conn) continue;

        let response: Response;
        const filePath = file.path === '/' ? file.name : `${file.path.substring(1)}/${file.name}`;

        if (isCloudProvider(conn.type)) {
          response = await fetch(`/api/rclone/files?remote=${encodeURIComponent(conn.accountName || '')}&path=${encodeURIComponent(filePath)}&isDir=false`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
        } else if (conn.type === ConnectionType.SFTP) {
          const fullPath = file.path === '/' ? `/${file.name}` : `${file.path}/${file.name}`;
          response = await fetch('/api/fs/sftp/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ host: conn.host, port: conn.port, connectionId: conn.id, path: fullPath, isDir: false })
          });
        } else if (conn.type === ConnectionType.FTP) {
          const fullPath = file.path === '/' ? `/${file.name}` : `${file.path}/${file.name}`;
          response = await fetch('/api/fs/ftp/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ host: conn.host, port: conn.port, connectionId: conn.id, path: fullPath, isDir: false })
          });
        } else if (conn.type === ConnectionType.S3) {
          const key = (file as any).s3Key || filePath;
          response = await fetch('/api/fs/s3/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ host: conn.host, bucket: conn.bucket, connectionId: conn.id, region: conn.region, keys: [key] })
          });
        } else {
          continue;
        }

        if (response.ok) {
          deletedCount++;
        } else {
          errorCount++;
        }
      } catch (e) {
        errorCount++;
      }
    }

    setIsDeleting(false);

    if (deletedCount > 0) {
      // Remove deleted items from candidates
      setCandidates(prev => prev.filter(c => !deletedIds.has(c.fileA.id) && !deletedIds.has(c.fileB.id)));
      setDeletedIds(new Set());
      alert(`${deletedCount} arquivo(s) excluído(s) com sucesso!${errorCount > 0 ? ` ${errorCount} erro(s).` : ''}`);
    } else if (errorCount > 0) {
      alert(`Erro ao excluir arquivos. ${errorCount} falha(s).`);
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const FileCard = ({ file, suggestion }: { file: FileItem, suggestion: boolean }) => {
    const isMarked = deletedIds.has(file.id);
    return (
      <div className={`flex-1 p-4 rounded-lg border transition-all ${
        isMarked ? 'bg-red-500/10 border-red-500/30 opacity-60' :
        suggestion ? 'bg-green-500/10 border-green-500/30' : 'bg-slate-800 border-slate-700'
      }`}>
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <HardDrive size={14} className="text-primary-400" />
            {file.connectionName}
          </div>
          {suggestion && !isMarked && (
            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Manter</span>
          )}
          {isMarked && (
            <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">Excluir</span>
          )}
        </div>

        <p className="text-sm text-white font-medium truncate mb-1" title={file.name}>{file.name}</p>

        <div className="text-xs text-slate-400 space-y-1">
          <p>{formatSize(file.size)}</p>
          <p>{new Date(file.modifiedAt).toLocaleDateString()}</p>
          <p className="truncate text-slate-500">{file.path}</p>
        </div>

        <div className="mt-4">
          <button
            onClick={() => handleMarkDelete(file.id)}
            className={`w-full py-1.5 text-xs rounded transition-colors flex items-center justify-center gap-1 ${
              isMarked
                ? 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                : 'bg-slate-700 hover:bg-red-500/20 hover:text-red-400 text-slate-300'
            }`}
          >
            {isMarked ? (
              <><CheckCircle size={12} /> Desmarcar</>
            ) : (
              <><Trash2 size={12} /> Marcar para Excluir</>
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-8 h-full overflow-y-auto max-w-6xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Sparkles className="text-purple-500" />
            Limpeza Inteligente
          </h2>
          <p className="text-slate-400 mt-2">
            A IA analisa seus arquivos em todos os provedores para encontrar duplicatas e liberar espaço.
          </p>
        </div>

        <button
          onClick={handleScan}
          disabled={isScanning || connections.filter(c => c.status === 'connected').length === 0}
          className={`px-6 py-3 rounded-xl font-semibold text-white flex items-center gap-2 transition-all shadow-lg shadow-purple-900/20 ${
            isScanning
              ? 'bg-slate-700 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100'
          }`}
        >
          {isScanning ? (
            <><Loader2 className="animate-spin" size={20} /> {scanProgress || 'Analisando...'}</>
          ) : (
            <><ScanLine /> Iniciar Scan IA</>
          )}
        </button>
      </div>

      {/* Stats */}
      {scanned && candidates.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
            <p className="text-2xl font-bold text-white">{candidates.length}</p>
            <p className="text-sm text-slate-400">Duplicatas encontradas</p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
            <p className="text-2xl font-bold text-green-400">{formatSize(totalSavings)}</p>
            <p className="text-sm text-slate-400">Economia potencial</p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
            <p className="text-2xl font-bold text-red-400">{deletedIds.size}</p>
            <p className="text-sm text-slate-400">Marcados para exclusão</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isScanning && !scanned && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center">
          <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6">
            <Sparkles className="text-slate-500" size={40} />
          </div>
          <h3 className="text-lg font-medium text-white mb-2">Pronto para otimizar</h3>
          <p className="text-slate-500 max-w-md mx-auto">
            {connections.filter(c => c.status === 'connected').length === 0
              ? 'Conecte-se a pelo menos um provedor de armazenamento para iniciar.'
              : 'Nossa IA irá comparar metadados e semântica de nomes para encontrar cópias desnecessárias entre seus servidores.'}
          </p>
        </div>
      )}

      {/* Scanning State */}
      {isScanning && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-6 animate-pulse">
              <div className="h-4 bg-slate-800 rounded w-1/3 mb-4"></div>
              <div className="flex gap-4">
                <div className="flex-1 h-32 bg-slate-800 rounded"></div>
                <div className="flex-1 h-32 bg-slate-800 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results - No duplicates */}
      {scanned && candidates.length === 0 && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-8 text-center flex flex-col items-center">
          <CheckCircle className="text-green-400 mb-4" size={48} />
          <h3 className="text-lg font-medium text-green-400">Tudo limpo!</h3>
          <p className="text-green-500/60">Nenhuma duplicata encontrada nos seus servidores.</p>
        </div>
      )}

      {/* Results - Duplicates found */}
      <div className="space-y-6">
        {candidates.map((group, idx) => (
          <div key={idx} className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <div className="bg-slate-800/50 px-6 py-3 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`px-2 py-1 rounded text-xs font-bold ${group.similarity > 90 ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                  {group.similarity}% Similaridade
                </div>
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <AlertCircle size={12} />
                  IA: {group.reason}
                </span>
              </div>
            </div>

            <div className="p-6 flex flex-col md:flex-row items-center gap-6">
              <FileCard file={group.fileA} suggestion={group.suggestion === 'keep_a'} />

              <div className="text-slate-600">
                <ArrowRight size={24} className="rotate-90 md:rotate-0" />
              </div>

              <FileCard file={group.fileB} suggestion={group.suggestion === 'keep_b'} />
            </div>
          </div>
        ))}
      </div>

      {/* Confirm Delete Button */}
      {scanned && candidates.length > 0 && deletedIds.size > 0 && (
        <div className="fixed bottom-8 right-8 animate-in slide-in-from-bottom-5">
          <button
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            className="bg-red-600 hover:bg-red-700 disabled:bg-red-800 text-white px-6 py-3 rounded-xl font-bold shadow-xl shadow-red-900/30 flex items-center gap-2"
          >
            {isDeleting ? (
              <><Loader2 className="animate-spin" size={20} /> Excluindo...</>
            ) : (
              <><Trash2 size={20} /> Confirmar Exclusão ({deletedIds.size})</>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default DuplicateManager;
