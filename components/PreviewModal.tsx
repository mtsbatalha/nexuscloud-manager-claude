import React, { useState, useEffect } from 'react';
import { X, FileText, Sparkles, Download, Share2, Loader2, Image, Film, Music, FileCode, AlertCircle } from 'lucide-react';
import { FileItem, Connection, ConnectionType } from '../types';
import { generateFileSummary } from '../services/gemini';

const getAuthToken = () => localStorage.getItem('nexus_token');

const isCloudProvider = (type?: ConnectionType) => {
  return type === ConnectionType.GDRIVE || type === ConnectionType.DROPBOX || type === ConnectionType.ONEDRIVE;
};

// File type helpers
const isImage = (name: string) => /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(name);
const isVideo = (name: string) => /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(name);
const isAudio = (name: string) => /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(name);
const isPDF = (name: string) => /\.pdf$/i.test(name);
const isText = (name: string) => /\.(txt|md|json|xml|html|css|js|ts|tsx|jsx|py|java|c|cpp|h|hpp|sh|yaml|yml|env|log|csv|sql|go|rs|rb|php)$/i.test(name);

interface PreviewModalProps {
  file: FileItem | null;
  onClose: () => void;
  activeConnection: Connection | null;
}

const PreviewModal: React.FC<PreviewModalProps> = ({ file, onClose, activeConnection }) => {
  const [summary, setSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !activeConnection) return;

    // Cleanup previous blob URL
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }

    setContent(null);
    setError(null);
    setSummary(null);

    const canPreview = isImage(file.name) || isVideo(file.name) || isAudio(file.name) || isPDF(file.name) || isText(file.name);

    if (!canPreview) {
      setError('Preview não disponível para este tipo de arquivo');
      return;
    }

    loadFileContent();
  }, [file?.id]);

  const loadFileContent = async () => {
    if (!file || !activeConnection) return;

    setLoading(true);
    setError(null);

    const token = getAuthToken();
    if (!token) {
      setError('Sessão expirada');
      setLoading(false);
      return;
    }

    try {
      let response: Response;
      const currentPath = file.path || '/';

      if (isCloudProvider(activeConnection.type)) {
        const remotePath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
        response = await fetch(`/api/rclone/download?remote=${encodeURIComponent(activeConnection.accountName || '')}&path=${encodeURIComponent(remotePath)}&isDir=false`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } else if (activeConnection.type === ConnectionType.SFTP) {
        const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        response = await fetch('/api/fs/sftp/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, port: activeConnection.port, connectionId: activeConnection.id, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.FTP) {
        const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        response = await fetch('/api/fs/ftp/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, port: activeConnection.port, connectionId: activeConnection.id, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.SMB) {
        const fullPath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
        response = await fetch('/api/fs/smb/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, share: activeConnection.share, connectionId: activeConnection.id, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.NFS) {
        const fullPath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
        response = await fetch('/api/fs/nfs/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ mountPoint: activeConnection.mountPoint, path: fullPath })
        });
      } else if (activeConnection.type === ConnectionType.S3) {
        const key = file.s3Key || (currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`);
        response = await fetch('/api/fs/s3/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ host: activeConnection.host, bucket: activeConnection.bucket, connectionId: activeConnection.id, region: activeConnection.region, key })
        });
      } else {
        throw new Error('Tipo de conexão não suportado');
      }

      if (!response.ok) {
        throw new Error('Erro ao carregar arquivo');
      }

      const blob = await response.blob();

      if (isText(file.name)) {
        const text = await blob.text();
        setContent(text);
      } else if (isPDF(file.name)) {
        // Ensure PDF has correct MIME type
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        const url = URL.createObjectURL(pdfBlob);
        setBlobUrl(url);
      } else {
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar preview');
    } finally {
      setLoading(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (!file) return null;

  const handleSummarize = async () => {
    if (!content) return;
    setLoadingSummary(true);
    const result = await generateFileSummary(file.name, content);
    setSummary(result);
    setLoadingSummary(false);
  };

  const getFileIcon = () => {
    if (isImage(file.name)) return <Image size={20} />;
    if (isVideo(file.name)) return <Film size={20} />;
    if (isAudio(file.name)) return <Music size={20} />;
    if (isText(file.name)) return <FileCode size={20} />;
    return <FileText size={20} />;
  };

  const handleDownload = () => {
    if (blobUrl) {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (content) {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  const handleShare = async () => {
    if (!activeConnection || !isCloudProvider(activeConnection.type)) {
      alert('Compartilhamento só disponível para provedores cloud');
      return;
    }
    const token = getAuthToken();
    if (!token) return;

    try {
      const currentPath = file.path || '/';
      const remotePath = currentPath === '/' ? file.name : `${currentPath.substring(1)}/${file.name}`;
      const response = await fetch('/api/rclone/publiclink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ remote: activeConnection.accountName, path: remotePath })
      });
      const data = await response.json();
      if (response.ok) {
        await navigator.clipboard.writeText(data.url);
        alert(`Link copiado:\n${data.url}`);
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-slate-400 flex flex-col items-center gap-3">
            <Loader2 size={48} className="animate-spin" />
            <p>Carregando preview...</p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-slate-500 flex flex-col items-center gap-3">
            <AlertCircle size={48} className="text-slate-600" />
            <p>{error}</p>
          </div>
        </div>
      );
    }

    if (isImage(file.name) && blobUrl) {
      return (
        <div className="flex items-center justify-center h-full p-4">
          <img src={blobUrl} alt={file.name} className="max-w-full max-h-full object-contain rounded-lg shadow-lg" />
        </div>
      );
    }

    if (isVideo(file.name) && blobUrl) {
      return (
        <div className="flex items-center justify-center h-full p-4">
          <video src={blobUrl} controls className="max-w-full max-h-full rounded-lg shadow-lg">
            Seu navegador não suporta vídeo.
          </video>
        </div>
      );
    }

    if (isAudio(file.name) && blobUrl) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="bg-slate-800/50 p-8 rounded-2xl flex flex-col items-center gap-6">
            <Music size={64} className="text-primary-400" />
            <p className="text-white font-medium">{file.name}</p>
            <audio src={blobUrl} controls className="w-80" />
          </div>
        </div>
      );
    }

    if (isPDF(file.name) && blobUrl) {
      return (
        <object data={blobUrl} type="application/pdf" className="w-full h-full">
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-400 flex flex-col items-center gap-3">
              <FileText size={48} />
              <p>Preview de PDF não suportado pelo navegador</p>
              <button onClick={handleDownload} className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm">
                Baixar PDF
              </button>
            </div>
          </div>
        </object>
      );
    }

    if (isText(file.name) && content !== null) {
      return (
        <pre className="text-slate-300 font-mono text-sm whitespace-pre-wrap leading-relaxed p-4 overflow-auto h-full">
          {content}
        </pre>
      );
    }

    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500 flex flex-col items-center gap-3">
          <FileText size={64} className="opacity-20" />
          <p>Preview não disponível</p>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 w-full max-w-5xl rounded-2xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              {getFileIcon()}
            </div>
            <div>
              <h3 className="font-semibold text-slate-100">{file.name}</h3>
              <p className="text-xs text-slate-500">{file.mimeType || 'Arquivo'} • {((file.size || 0) / 1024).toFixed(1)} KB</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleShare} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors" title="Compartilhar">
              <Share2 size={20} />
            </button>
            <button onClick={handleDownload} disabled={!blobUrl && !content} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors disabled:opacity-30" title="Download">
              <Download size={20} />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-red-500/10 hover:text-red-400 rounded-lg text-slate-400 transition-colors" title="Fechar">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex min-h-0">
          <div className="flex-1 bg-slate-950 overflow-auto">
            {renderContent()}
          </div>

          {/* AI Sidebar - only show for text files */}
          {isText(file.name) && content && (
            <div className="w-80 border-l border-slate-800 bg-slate-900/50 p-6 flex flex-col shrink-0">
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-slate-300 mb-1 flex items-center gap-2">
                  <Sparkles size={14} className="text-purple-400" />
                  Analista IA
                </h4>
                <p className="text-xs text-slate-500">Obtenha insights instantâneos sobre este arquivo.</p>
              </div>

              {!summary ? (
                <button
                  onClick={handleSummarize}
                  disabled={loadingSummary}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-purple-900/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loadingSummary ? (
                    <><Loader2 size={16} className="animate-spin" /> Analisando...</>
                  ) : (
                    <><Sparkles size={16} /> Gerar Resumo</>
                  )}
                </button>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                    <h5 className="text-xs uppercase tracking-wider font-bold text-slate-400 mb-3">Resumo</h5>
                    <p className="text-sm text-slate-300 leading-relaxed">{summary}</p>
                  </div>
                  <button onClick={() => setSummary(null)} className="mt-4 text-xs text-slate-500 hover:text-white underline">
                    Gerar novamente
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreviewModal;
