import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ScanLine } from 'lucide-react';
import { useTelegram } from '../../hooks/useTelegram';
import { classifyScannedInvite } from '../../utils/inviteLink';
import { Button } from '../Button';
import { Input } from '../Input';
import './DmInviteScanner.css';

/** Minimal BarcodeDetector typings (not in all TS DOM libs / Safari). */
interface QrBarcodeDetector {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
}

interface QrBarcodeDetectorCtor {
  new (options?: { formats?: string[] }): QrBarcodeDetector;
}

function getBarcodeDetectorCtor(): QrBarcodeDetectorCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { BarcodeDetector?: QrBarcodeDetectorCtor }).BarcodeDetector;
}

function canUseInlineQrCamera(): boolean {
  return Boolean(
    typeof navigator !== 'undefined'
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && getBarcodeDetectorCtor(),
  );
}

export interface DmInviteScannerProps {
  open: boolean;
  onClose: () => void;
  /** Personal DM invite token extracted from QR / paste */
  onDmToken: (token: string) => void;
  /** Room invite token — hand off to join-room (must not redeem as DM) */
  onRoomInvite: (token: string) => void;
  /** Disable submit while redeem is in flight */
  redeeming?: boolean;
}

type CameraStatus = 'idle' | 'starting' | 'live' | 'unavailable';

/**
 * In-app DM invite scanner (IMP-DMINVITE-03).
 * Camera: Telegram showScanQrPopup and/or getUserMedia + BarcodeDetector.
 * Paste fallback is always available (required for iOS WebView).
 */
export function DmInviteScanner({
  open,
  onClose,
  onDmToken,
  onRoomInvite,
  redeeming = false,
}: DmInviteScannerProps) {
  const { t } = useTranslation();
  const { canScanQr, showScanQrPopup, closeScanQrPopup, impactOccurred } = useTelegram();
  const [pasteValue, setPasteValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<QrBarcodeDetector | null>(null);
  const handledRef = useRef(false);
  const redeemingRef = useRef(redeeming);
  const onDmTokenRef = useRef(onDmToken);
  const onRoomInviteRef = useRef(onRoomInvite);

  redeemingRef.current = redeeming;
  onDmTokenRef.current = onDmToken;
  onRoomInviteRef.current = onRoomInvite;

  const stopCamera = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    detectorRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const handleRawText = useCallback(
    (raw: string) => {
      if (handledRef.current || redeemingRef.current) return;
      const classified = classifyScannedInvite(raw);
      if (classified.kind === 'dm' && classified.token) {
        handledRef.current = true;
        setError(null);
        impactOccurred('light');
        stopCamera();
        closeScanQrPopup();
        onDmTokenRef.current(classified.token);
        return;
      }
      if (classified.kind === 'room' && classified.token) {
        handledRef.current = true;
        setError(null);
        impactOccurred('light');
        stopCamera();
        closeScanQrPopup();
        onRoomInviteRef.current(classified.token);
        return;
      }
      setError(t('dmInvite.scanner.invalidQr'));
    },
    [impactOccurred, stopCamera, closeScanQrPopup, t],
  );

  const handleRawTextRef = useRef(handleRawText);
  handleRawTextRef.current = handleRawText;

  useEffect(() => {
    if (!open) {
      handledRef.current = false;
      setPasteValue('');
      setError(null);
      stopCamera();
      setCameraStatus('idle');
      return;
    }

    handledRef.current = false;

    if (!canUseInlineQrCamera()) {
      setCameraStatus('unavailable');
      return;
    }

    setCameraStatus('starting');
    let cancelled = false;

    const run = async () => {
      const Detector = getBarcodeDetectorCtor();
      if (!Detector || cancelled) {
        setCameraStatus('unavailable');
        return;
      }

      try {
        // Wait a frame so <video> is mounted after status → starting.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        if (cancelled) return;

        const detector = new Detector({ formats: ['qr_code'] });
        detectorRef.current = detector;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
        if (cancelled) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          setCameraStatus('unavailable');
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) {
          stopCamera();
          return;
        }
        setCameraStatus('live');

        const tick = async () => {
          if (cancelled || !detectorRef.current || !videoRef.current || handledRef.current) {
            return;
          }
          try {
            const codes = await detectorRef.current.detect(videoRef.current);
            const raw = codes[0]?.rawValue;
            if (raw) {
              handleRawTextRef.current(raw);
              return;
            }
          } catch {
            // Keep scanning; transient detect errors are common.
          }
          rafRef.current = requestAnimationFrame(() => {
            void tick();
          });
        };
        rafRef.current = requestAnimationFrame(() => {
          void tick();
        });
      } catch {
        if (!cancelled) {
          stopCamera();
          setCameraStatus('unavailable');
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, stopCamera]);

  const handleTelegramScan = useCallback(async () => {
    setError(null);
    impactOccurred('light');
    const scanned = await showScanQrPopup(t('dmInvite.scanner.cameraHint'));
    if (scanned == null) {
      return;
    }
    closeScanQrPopup();
    handleRawText(scanned);
  }, [impactOccurred, showScanQrPopup, closeScanQrPopup, handleRawText, t]);

  const handlePasteSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      handleRawText(pasteValue);
    },
    [handleRawText, pasteValue],
  );

  if (!open) {
    return null;
  }

  const showInlinePreview = cameraStatus === 'starting' || cameraStatus === 'live';
  const showCameraUnavailable =
    cameraStatus === 'unavailable' && !canScanQr;

  return (
    <div
      className="dm-invite-scanner-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dm-invite-scanner-title"
      onClick={onClose}
    >
      <div
        className="dm-invite-scanner"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="dm-invite-scanner-title" className="dm-invite-scanner__title">
          {t('dmInvite.scanner.title')}
        </h3>
        <p className="dm-invite-scanner__caption">
          {t('dmInvite.scanner.caption')}
        </p>

        {showInlinePreview && (
          <div className="dm-invite-scanner__preview">
            <video
              ref={videoRef}
              className="dm-invite-scanner__video"
              muted
              playsInline
              autoPlay
            />
            {cameraStatus === 'starting' && (
              <p className="dm-invite-scanner__status">
                {t('dmInvite.scanner.startingCamera')}
              </p>
            )}
          </div>
        )}

        {canScanQr && (
          <Button
            variant="primary"
            fullWidth
            onClick={() => {
              void handleTelegramScan();
            }}
            disabled={redeeming}
            leftIcon={<ScanLine size={16} aria-hidden="true" />}
          >
            {t('dmInvite.scanner.scanButton')}
          </Button>
        )}

        {showCameraUnavailable && (
          <p className="dm-invite-scanner__hint" role="status">
            {t('dmInvite.scanner.cameraUnavailable')}
          </p>
        )}

        <p className="dm-invite-scanner__hint">
          {t('dmInvite.scanner.systemCameraHint')}
        </p>

        <form className="dm-invite-scanner__paste" onSubmit={handlePasteSubmit}>
          <Input
            id="dm-invite-scanner-paste"
            label={t('dmInvite.scanner.pasteLabel')}
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder={t('dmInvite.scanner.pastePlaceholder')}
            disabled={redeeming}
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="submit"
            variant="secondary"
            fullWidth
            disabled={redeeming || pasteValue.trim().length === 0}
          >
            {t('dmInvite.scanner.pasteSubmit')}
          </Button>
        </form>

        {error && (
          <p className="dm-invite-scanner__error" role="alert">
            {error}
          </p>
        )}

        <Button variant="secondary" onClick={onClose} fullWidth disabled={redeeming}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
