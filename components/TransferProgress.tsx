import React from 'react';
import { X, Copy, Check, AlertCircle, RefreshCw, FolderInput, ExternalLink } from 'lucide-react';
import { useTransfer, TransferInfo } from '../contexts/TransferContext';

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const TransferItem: React.FC<{
  transfer: TransferInfo;
  onRemove: () => void;
  onRetry: () => void;
  onNavigate?: (connId: string, path: string) => void;
}> = ({ transfer, onRemove, onRetry, onNavigate }) => {
  const elapsed = (Date.now() - transfer.startTime) / 1000;
  const bytesTransferred = (transfer.progress / 100) * transfer.fileSize;
  const speed = elapsed > 0 ? bytesTransferred / elapsed : 0;

  const formatSpeed = (s: number) => {
    if (s < 1024) return `${Math.round(s)} B/s`;
    if (s < 1024 * 1024) return `${(s / 1024).toFixed(1)} KB/s`;
    return `${(s / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const getETA = () => {
    if (transfer.progress > 5 && transfer.progress < 100) {
      const estimated = (elapsed / transfer.progress) * (100 - transfer.progress);
      if (estimated < 60) return `~${Math.ceil(estimated)}s`;
      return `~${Math.ceil(estimated / 60)}min`;
    }
    return transfer.progress < 5 ? 'Calculando...' : '';
  };

  return (
    <div className={`bg-slate-800 border ${transfer.failed ? 'border-red-500/50' : 'border-slate-700'} p-4 rounded-xl shadow-2xl min-w-[380px] max-w-[450px] animate-in slide-in-from-bottom-2`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {transfer.failed ? (
            <AlertCircle size={20} className="text-red-400" />
          ) : transfer.progress === 100 ? (
            <Check size={20} className="text-green-400" />
          ) : transfer.actionType === 'move' ? (
            <FolderInput size={20} className="text-primary-400" />
          ) : (
            <Copy size={20} className="text-primary-400" />
          )}
          <span className="text-white font-medium">
            {transfer.failed ? 'Falha na transferência' : transfer.progress === 100 ? 'Transferência concluída' : `${transfer.actionType === 'move' ? 'Movendo' : 'Copiando'}...`}
          </span>
        </div>
        {!transfer.failed && transfer.progress < 100 && (
          <button onClick={onRemove} className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded" title="Cancelar">
            <X size={18} />
          </button>
        )}
      </div>

      {/* File info */}
      <div className="mb-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 w-14">Arquivo:</span>
          <span className="text-slate-300 truncate flex-1" title={transfer.fileName}>{transfer.fileName}</span>
          <span className="text-slate-500">{formatSize(transfer.fileSize)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 w-14">De:</span>
          {onNavigate ? (
            <button
              onClick={() => onNavigate(transfer.srcConnId, transfer.srcPath)}
              className="text-primary-400 hover:text-primary-300 truncate flex-1 text-left flex items-center gap-1 hover:underline"
              title={`Abrir: ${transfer.srcInfo}`}
            >
              <span className="truncate">{transfer.srcInfo}</span>
              <ExternalLink size={10} className="shrink-0" />
            </button>
          ) : (
            <span className="text-slate-400 truncate flex-1" title={transfer.srcInfo}>{transfer.srcInfo}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 w-14">Para:</span>
          {onNavigate ? (
            <button
              onClick={() => onNavigate(transfer.dstConnId, transfer.dstPath)}
              className="text-primary-400 hover:text-primary-300 truncate flex-1 text-left flex items-center gap-1 hover:underline"
              title={`Abrir: ${transfer.dstInfo}`}
            >
              <span className="truncate">{transfer.dstInfo}</span>
              <ExternalLink size={10} className="shrink-0" />
            </button>
          ) : (
            <span className="text-slate-400 truncate flex-1" title={transfer.dstInfo}>{transfer.dstInfo}</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className={`w-full ${transfer.failed ? 'bg-red-900/30' : 'bg-slate-700'} rounded-full h-2.5 overflow-hidden mb-2`}>
        {transfer.failed ? (
          <div className="h-full bg-red-500 w-full" />
        ) : (
          <div
            className={`h-full transition-all duration-300 ${transfer.progress === 100 ? 'bg-green-500' : 'bg-gradient-to-r from-primary-500 to-blue-500'}`}
            style={{ width: `${transfer.progress}%` }}
          />
        )}
      </div>

      {/* Progress info */}
      {!transfer.failed && (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{Math.round(transfer.progress)}% concluído</span>
          {transfer.progress < 100 && transfer.progress > 5 && transfer.fileSize > 0 && (
            <span>{formatSpeed(speed)}</span>
          )}
          {transfer.progress < 100 && (
            <span>{getETA()}</span>
          )}
          {transfer.progress === 100 && <span className="text-green-400">✓ Concluído</span>}
        </div>
      )}

      {/* Error message */}
      {transfer.failed && (
        <p className="text-xs text-red-400 mb-2">{transfer.status}</p>
      )}

      {/* Retry/Close buttons */}
      {transfer.failed && (
        <div className="flex gap-2 mt-3">
          <button onClick={onRetry} className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white text-sm rounded-lg">
            <RefreshCw size={14} /> Repetir
          </button>
          <button onClick={onRemove} className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg">
            <X size={14} /> Fechar
          </button>
        </div>
      )}
    </div>
  );
};

const TransferProgress: React.FC = () => {
  const { transfers, removeTransfer, retryTransfer, onNavigate } = useTransfer();

  if (transfers.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-4 z-50 space-y-3">
      {transfers.map(transfer => (
        <TransferItem
          key={transfer.id}
          transfer={transfer}
          onRemove={() => removeTransfer(transfer.id)}
          onRetry={() => {
            // Retry will be handled by the component that initiated the transfer
            removeTransfer(transfer.id);
          }}
          onNavigate={onNavigate || undefined}
        />
      ))}
    </div>
  );
};

export default TransferProgress;
