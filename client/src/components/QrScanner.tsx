import { useEffect, useRef, useState } from 'react';
import type jsQRType from 'jsqr';
import styles from './QrScanner.module.css';

type CameraProblem = 'denied' | 'not_found' | 'failed';

const INSECURE_TEXT = 'Камера доступна лише через HTTPS або localhost. Введи код вручну нижче.';

const PROBLEM_TEXT: Readonly<Record<CameraProblem, string>> = {
  denied: 'Доступ до камери заборонено. Дозволь камеру в налаштуваннях браузера або введи код вручну.',
  not_found: 'Камеру не знайдено на цьому пристрої. Введи код вручну нижче.',
  failed: 'Не вдалося увімкнути камеру. Спробуй ще раз або введи код вручну.',
};

// Розпізнавання раз на ~150 мс і зменшений кадр: телефон не перегрівається, а QR на папері
// все одно читається за долі секунди.
const SCAN_INTERVAL_MS = 150;
const MAX_FRAME_WIDTH = 640;

function problemFromError(error: unknown): CameraProblem {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'denied';
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return 'not_found';
  }
  return 'failed';
}

// Сканер QR кімнати (US-5.1). Прочитаний вміст віддається один раз через onDetected і ніде
// не показується й не логується: токен — секрет кімнати (FB-12). Потік камери зупиняється,
// коли сканер вимикають або сторінку залишають.
export function QrScanner({ onDetected }: { onDetected: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(true);
  // Останній колбек без перезапуску камери при кожному render батька.
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  // Камера працює лише в захищеному контексті (#36, питання 7): HTTP за IP ноутбука не підходить.
  const insecure = !window.isSecureContext || !navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (insecure || !videoRef.current) return;
    const video: HTMLVideoElement = videoRef.current;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let decode: typeof jsQRType | null = null;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    function stop() {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
    }

    function scanFrame() {
      if (stopped || !context || !decode) return;
      if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = decode(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
        // Порожній QR не надсилаємо: сервер однаково відхилив би його як VALIDATION_ERROR.
        if (code && code.data.length > 0) {
          stop();
          onDetectedRef.current(code.data);
          return;
        }
      }
      timer = window.setTimeout(scanFrame, SCAN_INTERVAL_MS);
    }

    async function start() {
      try {
        // Декодер завантажується окремим файлом лише тут: решта екранів на телефоні його не тягне.
        // Завантаження йде паралельно з запитом камери, а помилку чекаємо вже після того, як потік
        // записано в stream, щоб stop() його точно зупинив.
        const decoderLoading = import('jsqr');
        decoderLoading.catch(() => undefined);
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        decode = (await decoderLoading).default;
        if (stopped) return;
        video.srcObject = media;
        await video.play();
        if (stopped) return;
        setStarting(false);
        scanFrame();
      } catch (error) {
        if (stopped) return;
        stop();
        setProblem(problemFromError(error));
        setStarting(false);
      }
    }

    void start();
    return stop;
  }, [attempt, insecure]);

  function retryCamera() {
    setProblem(null);
    setStarting(true);
    setAttempt((value) => value + 1);
  }

  if (insecure) {
    return (
      <div className={styles.problem} role="alert">
        <p>{INSECURE_TEXT}</p>
      </div>
    );
  }

  return (
    <div className={styles.scanner}>
      <div className={styles.viewport} hidden={problem !== null}>
        {/* muted і playsInline потрібні iOS Safari, щоб показати камеру без повноекранного режиму. */}
        <video ref={videoRef} className={styles.video} muted playsInline aria-label="Зображення з камери" />
        <div className={styles.frame} aria-hidden="true" />
      </div>
      {problem === null ? (
        <p className={styles.hint} role="status">
          {starting ? 'Вмикаємо камеру…' : 'Наведи камеру на QR-код кімнати.'}
        </p>
      ) : (
        <div className={styles.problem} role="alert">
          <p>{PROBLEM_TEXT[problem]}</p>
          <button type="button" onClick={retryCamera}>
            Увімкнути камеру ще раз
          </button>
        </div>
      )}
    </div>
  );
}
