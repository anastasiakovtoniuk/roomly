import { EmptyState } from '../components/EmptyState';

// Оболонка розділу адміністратора (#45): форми кімнат і слотів додає наступний PR цього issue.
export function AdminRoomsPage() {
  return (
    <div>
      <h1>Кімнати й слоти</h1>
      <EmptyState
        title="Форми ще в роботі"
        description="Тут з’являться створення й редагування кімнат та створення слотів."
      />
    </div>
  );
}
