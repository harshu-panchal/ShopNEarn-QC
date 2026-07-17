import React, { useState } from 'react';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadRemoteFile } from '@shared/utils/downloadFile';

const PaymentScreenshotPreview = ({
  screenshotUrl,
  downloadFilename = 'payment-screenshot',
  label = 'Payment Screenshot',
  emptyMessage = 'No screenshot submitted yet.',
  maxHeightClass = 'max-h-[480px]',
}) => {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!screenshotUrl || downloading) return;

    setDownloading(true);
    try {
      await downloadRemoteFile(screenshotUrl, downloadFilename);
      toast.success('Screenshot downloaded');
    } catch {
      toast.error('Could not download screenshot');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
          {label}
        </p>
        {screenshotUrl && (
          <div className="flex items-center gap-2">
            <a
              href={screenshotUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
            >
              <ExternalLink size={12} />
              Open
            </a>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 hover:text-slate-900 disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Download size={12} />
              )}
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          </div>
        )}
      </div>

      {screenshotUrl ? (
        <a
          href={screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="block bg-slate-50 border border-slate-200 rounded-xl p-3 hover:bg-slate-100"
        >
          <img
            src={screenshotUrl}
            alt="Payment screenshot"
            className={`w-full ${maxHeightClass} object-contain rounded-md`}
          />
          <p className="text-[11px] text-indigo-600 mt-2 text-center">
            Click to open full size in new tab
          </p>
        </a>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-xl py-12 text-center">
          <p className="text-sm text-slate-500">{emptyMessage}</p>
        </div>
      )}
    </div>
  );
};

export default PaymentScreenshotPreview;
