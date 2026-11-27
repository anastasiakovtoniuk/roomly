import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import type { QrTokenResponse } from '@roomly/shared';
import { getRoomQr } from '../api/adminBookings';
import { ApiError, NetworkError } from '../api/http';
import { ErrorMessage } from '../components/ErrorMessage';
import { Loader } from '../components/Loader';
import styles from './AdminRoomQrPage.module.css';

type QrState =
  { kind: 'ready'; roomId: string; qr: QrTokenResponse } | { kind: 'error'; roomId: string; error: unknown };

// /admin/rooms/:roomId/qr: QR кімнати для друку (US-A.4a, US-A.4b). QR статичний і належить
// кімнаті (FB-13). Токен потрібен лише для зображення: текстом він не показується, в URL, логи
// й сховище не потрапляє (FB-12). Друк і зчитування з паперу перевіряються вручну (Q14).
export function AdminRoomQrPage() {
  const { roomId } = useParams();
  const [state, setState] = useState<QrState | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    void getRoomQr(roomId, controller.signal).then(
      (qr) => {
        if (controller.signal.aborted) return;
        // Відповідь іншої кімнати не повинна потрапити на друк під назвою цієї.
        if (qr.roomId !== roomId) {
          setState({
            kind: 'error',
            roomId,
            error: new NetworkError(new Error('Відповідь не відповідає обраній кімнаті')),
          });
          return;
        }
        setState({ kind: 'ready', roomId, qr });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', roomId, error });
      },
    );
    return () => controller.abort();
  }, [roomId, version]);

  const current = state !== null && state.roomId === roomId ? state : null;

  function reload() {
    setState(null);
    setVersion((value) => value + 1);
  }

  return (
    <div className={styles.page}>
      <header className={styles.noPrint}>
        <p className={styles.eyebrow}>Адміністрування</p>
        <h1>QR-код кімнати</h1>
        <p className={styles.intro}>
          Надрукуй код і розмісти його в кімнаті. Код постійний: повторний друк дасть той самий QR.
        </p>
      </header>

      {!roomId ? (
        <ErrorMessage error={new ApiError(404, 'ROOM_NOT_FOUND', '')} />
      ) : !current ? (
        <Loader label="Завантажуємо QR-код…" />
      ) : current.kind === 'error' ? (
        <ErrorMessage error={current.error} onRetry={reload} />
      ) : (
        <>
          <section className={styles.sheet} aria-labelledby="qr-room-name">
            <div className={styles.code}>
              {/* Завжди чорне на білому: у темній темі й на папері QR має однаково читатися. */}
              <QRCodeSVG
                value={current.qr.qrToken}
                size={320}
                level="M"
                marginSize={4}
                bgColor="#ffffff"
                fgColor="#000000"
                title={`QR-код кімнати ${current.qr.roomName}`}
                className={styles.svg}
              />
            </div>
            <h2 id="qr-room-name" className={styles.roomName}>
              {current.qr.roomName}
            </h2>
            <p className={`${styles.caption} ${styles.noPrint}`}>
              Студент сканує цей код на екрані «Підтвердити присутність».
            </p>
          </section>
          <div className={`${styles.actions} ${styles.noPrint}`}>
            <button type="button" onClick={() => window.print()}>
              Друкувати
            </button>
          </div>
        </>
      )}

      <Link className={`${styles.back} ${styles.noPrint}`} to="/admin/rooms">
        До кімнат
      </Link>
    </div>
  );
}
