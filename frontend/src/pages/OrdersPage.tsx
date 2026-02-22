import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Layers, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '../api/client';
import type { OrderBatchCreate } from '../api/client';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader } from '../components/Card';
import { useToast } from '../contexts/ToastContext';

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

export function OrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [libraryFileId, setLibraryFileId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [previewPlateCount, setPreviewPlateCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const parsedLibraryFileId = useMemo(() => parsePositiveInt(libraryFileId), [libraryFileId]);
  const isCreateValid = name.trim().length > 0 && parsedLibraryFileId !== null;

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders'],
    queryFn: api.getOrders,
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: (payload: OrderBatchCreate) => api.createOrder(payload),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setShowCreate(false);
      setName('');
      setLibraryFileId('');
      setDueDate('');
      setNotes('');
      setPreviewPlateCount(null);
      navigate(`/orders/${order.id}`);
    },
    onError: (err: Error) => {
      showToast(err.message || t('orders.createFailed'), 'error');
    },
  });

  const loadPlatePreview = async () => {
    if (!parsedLibraryFileId) {
      showToast(t('orders.createValidationError'), 'error');
      return;
    }
    setPreviewLoading(true);
    try {
      const data = await api.getLibraryFilePlates(parsedLibraryFileId);
      setPreviewPlateCount(data.plates?.length ?? 0);
    } catch (err) {
      setPreviewPlateCount(null);
      showToast(err instanceof Error ? err.message : t('orders.previewFailed'), 'error');
    } finally {
      setPreviewLoading(false);
    }
  };

  const onCreate = () => {
    if (!isCreateValid || !parsedLibraryFileId) {
      showToast(t('orders.createValidationError'), 'error');
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      library_file_id: parsedLibraryFileId,
      due_date: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
      notes: notes.trim() || null,
    });
  };

  return (
    <div className="p-4 md:p-8 min-h-[calc(100vh-64px)] space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t('orders.title')}</h1>
          <p className="text-sm text-bambu-gray">{t('orders.subtitle')}</p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>
          <Plus className="w-4 h-4" />
          {showCreate ? t('orders.closeCreate') : t('orders.newOrder')}
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader className="px-4 py-3">
            <h2 className="text-white font-medium">{t('orders.createFromLibraryFile')}</h2>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-sm text-bambu-gray-light mb-1">{t('orders.orderName')}</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded px-3 py-2 text-white"
                  placeholder={t('orders.orderNamePlaceholder')}
                />
              </div>
              <div>
                <label className="block text-sm text-bambu-gray-light mb-1">{t('orders.libraryFileId')}</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    value={libraryFileId}
                    onChange={(e) => setLibraryFileId(e.target.value)}
                    className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded px-3 py-2 text-white"
                    placeholder={t('orders.libraryFileIdPlaceholder')}
                  />
                  <Button
                    variant="secondary"
                    onClick={loadPlatePreview}
                    disabled={previewLoading || parsedLibraryFileId === null}
                    title={parsedLibraryFileId === null ? t('orders.createValidationError') : undefined}
                  >
                    {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('orders.preview')}
                  </Button>
                </div>
                {previewPlateCount !== null && (
                  <p className="text-xs text-bambu-gray mt-1">{t('orders.detectedPlates', { count: previewPlateCount })}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-sm text-bambu-gray-light mb-1">{t('orders.dueDateOptional')}</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-bambu-gray-light mb-1">{t('orders.notesOptional')}</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-bambu-dark border border-bambu-dark-tertiary rounded px-3 py-2 text-white"
                  placeholder={t('orders.notesPlaceholder')}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={onCreate} disabled={!isCreateValid || createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('orders.creatingOrder')}
                  </>
                ) : (
                  t('orders.createOrder')
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="px-4 py-3">
          <h2 className="text-white font-medium">{t('orders.orderList')}</h2>
        </CardHeader>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-bambu-gray">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('orders.loadingOrders')}
            </div>
          ) : !orders?.length ? (
            <div className="text-bambu-gray">{t('orders.noOrders')}</div>
          ) : (
            <div className="space-y-2">
              {orders.map((order) => (
                <Link key={order.id} to={`/orders/${order.id}`} className="block">
                  <div className="flex items-center justify-between rounded-xl border border-bambu-dark-tertiary bg-gradient-to-br from-bambu-card to-bambu-dark-secondary p-3 hover:border-bambu-green/30 transition-all">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-white">
                        <Layers className="w-4 h-4 text-bambu-green" />
                        <span className="font-medium truncate">{order.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-bambu-dark-secondary border border-bambu-dark-tertiary text-bambu-gray-light">
                          {order.status}
                        </span>
                      </div>
                      <div className="text-xs text-bambu-gray mt-1 truncate">
                        {t('orders.listMeta', {
                          file: order.source_file_name,
                          plates: order.plate_count,
                          configs: order.config_count,
                          qty: order.total_quantity_target,
                          remaining: order.total_remaining_to_dispatch,
                        })}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-bambu-gray shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
