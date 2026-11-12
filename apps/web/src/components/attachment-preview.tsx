'use client';

import { useState } from 'react';
import Image from 'next/image';
import { FileText, ImageIcon, Eye } from 'lucide-react';
import { Modal } from './ui/dialog';
import { DocumentPreview } from './document-preview';
import { AudioPlayer } from './audio-player';
import { DownloadButton } from './downloads';
import { formatFileSize } from '@/lib/downloads';
import { useAttachmentStatus } from '@/lib/attachment-status';

export type AttachmentInfo = {
  id: string;
  filename: string;
  detectedMime: string | null;
  scanStatus: string;
  size?: number | null;
  durationSeconds?: number | null;
  waveform?: unknown;
};

export function AttachmentPreview({ file: initial }: { file: AttachmentInfo }) {
  const file = useAttachmentStatus(initial);
  const [open, setOpen] = useState(false);
  const url = `/api/v1/attachments/${file.id}/access`;
  if (file.scanStatus !== 'CLEAN')
    return (
      <div
        className={`attachment processing-attachment ${file.scanStatus === 'REJECTED' ? 'rejected' : ''}`}
      >
        <FileText size={18} />
        <bdi>{file.filename}</bdi>
        <small>
          {file.scanStatus === 'REJECTED' ? 'فایل پذیرفته نشد' : 'در انتظار بررسی امنیتی'}
        </small>
      </div>
    );
  if (file.detectedMime?.startsWith('audio/'))
    return (
      <div className="audio-attachment">
        <AudioPlayer src={url} durationSeconds={file.durationSeconds} waveform={file.waveform} />
        <DownloadButton file={file} />
      </div>
    );
  if (file.detectedMime?.startsWith('video/'))
    return (
      <div className="video-attachment">
        <video
          controls
          playsInline
          preload="none"
          src={url}
          aria-label={`ویدیو ${file.filename}`}
        />
        <div className="attachment-card-meta">
          <bdi>{file.filename}</bdi>
          <DownloadButton file={file} />
        </div>
      </div>
    );
  const image = file.detectedMime?.startsWith('image/');
  return (
    <>
      <div className="attachment-card">
        {image && (
          <button
            type="button"
            className="attachment-thumbnail"
            aria-label={`پیش‌نمایش ${file.filename}`}
            onClick={() => setOpen(true)}
          >
            <Image
              src={`/api/v1/attachments/${file.id}/thumbnail`}
              unoptimized
              alt={file.filename}
              loading="lazy"
              decoding="async"
              width={300}
              height={180}
              style={{ objectFit: 'cover', width: '100%', height: '100%' }}
            />
          </button>
        )}
        <div className="attachment-card-meta">
          {image ? <ImageIcon size={20} /> : <FileText size={20} />}
          <div>
            <bdi>{file.filename}</bdi>
            {file.size && <small dir="ltr">{formatFileSize(file.size)}</small>}
          </div>
          <button
            type="button"
            className="attachment-action"
            aria-label={`پیش‌نمایش ${file.filename}`}
            onClick={() => setOpen(true)}
          >
            <Eye size={17} />
          </button>
          <DownloadButton file={file} />
        </div>
      </div>
      <Modal
        wide
        open={open}
        onOpenChange={setOpen}
        title="پیش‌نمایش فایل"
        description={file.filename}
        className="attachment-preview-dialog"
      >
        <div
          className={`attachment-preview-body${image ? ' image-preview-scroll preview-scroll' : ''}`}
          role={image ? 'region' : undefined}
          aria-label={image ? file.filename : undefined}
          tabIndex={image ? 0 : undefined}
        >
          {image ? (
            <Image
              src={url}
              unoptimized
              alt={file.filename}
              width={850}
              height={650}
              style={{ width: '100%', height: 'auto' }}
            />
          ) : (
            <DocumentPreview file={file} url={url} />
          )}
        </div>
        <div className="preview-footer">
          <DownloadButton file={file} full />
        </div>
      </Modal>
    </>
  );
}
