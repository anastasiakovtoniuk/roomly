import { EmptyState } from '../components/EmptyState';

// Тимчасові місця для екранів із #13; не імітують успішних дій.
export function PendingPage({ title }: { title: string }) {
  return <EmptyState title={title} description="Цей екран ще готується." />;
}
