/**
 * Tests for the PrinterQueueWidget component.
 *
 * This is a compact widget that shows "Next in queue" with the first pending
 * item's name and a "+N" badge if there are more items. Returns null when empty.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '../utils';
import { PrinterQueueWidget } from '../../components/PrinterQueueWidget';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import userEvent from '@testing-library/user-event';

const mockQueueItems = [
  {
    id: 1,
    printer_id: 1,
    archive_id: 1,
    position: 1,
    status: 'pending',
    archive_name: 'First Print',
    printer_name: 'X1 Carbon',
    print_time_seconds: 3600,
    scheduled_time: null,
  },
  {
    id: 2,
    printer_id: 1,
    archive_id: 2,
    position: 2,
    status: 'pending',
    archive_name: 'Second Print',
    printer_name: 'X1 Carbon',
    print_time_seconds: 7200,
    scheduled_time: null,
  },
];

describe('PrinterQueueWidget', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/v1/queue/', ({ request }) => {
        const url = new URL(request.url);
        const printerId = url.searchParams.get('printer_id');
        if (printerId === '1') {
          return HttpResponse.json(mockQueueItems);
        }
        return HttpResponse.json([]);
      })
    );
  });

  describe('rendering', () => {
    it('shows next in queue label', async () => {
      render(<PrinterQueueWidget printerId={1} />);

      await waitFor(() => {
        expect(screen.getByText('Next in queue')).toBeInTheDocument();
      });
    });

    it('shows first pending item name', async () => {
      render(<PrinterQueueWidget printerId={1} />);

      await waitFor(() => {
        expect(screen.getByText('First Print')).toBeInTheDocument();
      });
    });

    it('shows additional items badge when multiple pending', async () => {
      render(<PrinterQueueWidget printerId={1} />);

      await waitFor(() => {
        // Shows "+1" badge since there are 2 items
        expect(screen.getByText('+1')).toBeInTheDocument();
      });
    });

    it('shows Waiting for unscheduled items', async () => {
      render(<PrinterQueueWidget printerId={1} />);

      await waitFor(() => {
        expect(screen.getByText('Waiting')).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('renders nothing when no pending items', async () => {
      const { container } = render(<PrinterQueueWidget printerId={999} />);

      // Wait for query to resolve
      await waitFor(() => {
        // Widget returns null when empty, so container should have no visible widget
        expect(container.querySelector('a[href="/queue"]')).not.toBeInTheDocument();
      });
    });
  });

  describe('single item', () => {
    it('does not show badge when only one item', async () => {
      server.use(
        http.get('/api/v1/queue/', () => {
          return HttpResponse.json([mockQueueItems[0]]);
        })
      );

      render(<PrinterQueueWidget printerId={1} />);

      await waitFor(() => {
        expect(screen.getByText('First Print')).toBeInTheDocument();
      });

      // Should not have a "+N" badge
      expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    });
  });

  describe('link behavior', () => {
    it('links to queue page', async () => {
      render(<PrinterQueueWidget printerId={1} />);

      await waitFor(() => {
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', '/queue');
      });
    });
  });

  describe('manual slicer user correction', () => {
    it('opens a modal from the red warning badge and saves a manual user badge', async () => {
      const user = userEvent.setup();
      const queueItems = [
        {
          ...mockQueueItems[0],
          slicer_user: null,
          slicer_user_email: null,
        },
      ];

      server.use(
        http.get('/api/v1/queue/', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get('printer_id') === '1') {
            return HttpResponse.json(queueItems);
          }
          return HttpResponse.json([]);
        }),
        http.patch('/api/v1/archives/1', async ({ request }) => {
          const body = await request.json() as { slicer_user?: string | null };
          queueItems[0] = {
            ...queueItems[0],
            slicer_user: body.slicer_user ?? null,
            slicer_user_email: null,
          };
          return HttpResponse.json({
            id: 1,
            printer_id: 1,
            project_id: null,
            project_name: null,
            filename: 'first.3mf',
            file_path: 'archive/first.3mf',
            file_size: 1,
            content_hash: null,
            thumbnail_path: null,
            timelapse_path: null,
            source_3mf_path: null,
            f3d_path: null,
            duplicates: null,
            duplicate_count: 0,
            duplicate_sequence: 0,
            original_archive_id: null,
            object_count: null,
            print_name: 'First Print',
            print_time_seconds: 3600,
            actual_time_seconds: null,
            time_accuracy: null,
            filament_used_grams: null,
            filament_type: null,
            filament_color: null,
            layer_height: null,
            total_layers: null,
            nozzle_diameter: null,
            bed_temperature: null,
            nozzle_temperature: null,
            sliced_for_model: null,
            status: 'archived',
            started_at: null,
            completed_at: null,
            extra_data: null,
            makerworld_url: null,
            designer: null,
            external_url: null,
            is_favorite: false,
            tags: null,
            notes: null,
            cost: null,
            private_job: false,
            private_material: false,
            private_material_partial: false,
            photos: null,
            failure_reason: null,
            quantity: 1,
            energy_kwh: null,
            energy_cost: null,
            created_at: '2026-04-23T00:00:00Z',
            created_by_id: null,
            created_by_username: null,
            slicer_user: body.slicer_user ?? null,
            slicer_user_email: null,
          });
        })
      );

      render(<PrinterQueueWidget printerId={1} />);

      await waitFor(() => {
        expect(screen.getByText('Please only use AIK printer profile')).toBeInTheDocument();
      });

      await user.click(screen.getByTitle('Add missing user badge'));

      await waitFor(() => {
        expect(screen.getByText('Set user badge')).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText('User badge'), 'alice');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText('alice')).toBeInTheDocument();
      });
    });
  });
});
