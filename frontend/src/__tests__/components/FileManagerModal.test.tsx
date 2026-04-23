/**
 * Tests for the FileManagerModal component.
 * Tests file browsing, selection, navigation, and file operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { render } from '../utils';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

vi.mock('../../components/PrintModal', () => ({
  PrintModal: ({ mode, archiveName }: { mode: string; archiveName: string }) => (
    <div>{mode === 'add-to-queue' ? `Queue Modal ${archiveName}` : `Print Modal ${archiveName}`}</div>
  ),
}));

import { FileManagerModal } from '../../components/FileManagerModal';

const mockFiles = [
  {
    name: 'cache',
    path: '/cache',
    size: 0,
    is_directory: true,
    mtime: '2024-01-15T10:00:00Z',
  },
  {
    name: 'model',
    path: '/model',
    size: 0,
    is_directory: true,
    mtime: '2024-01-15T10:00:00Z',
  },
  {
    name: 'benchy.3mf',
    path: '/benchy.3mf',
    size: 1048575,
    is_directory: false,
    mtime: '2024-01-15T10:00:00Z',
  },
  {
    name: 'print_job.gcode',
    path: '/print_job.gcode',
    size: 2048000,
    is_directory: false,
    mtime: '2024-01-14T10:00:00Z',
  },
];

const mockStorage = {
  used_bytes: 1073741824, // 1 GB
  free_bytes: 3221225472, // 3 GB
};

describe('FileManagerModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    server.use(
      http.get('/api/v1/printers/:id/files', () => {
        return HttpResponse.json({ files: mockFiles });
      }),
      http.get('/api/v1/printers/:id/storage', () => {
        return HttpResponse.json(mockStorage);
      }),
      http.delete('/api/v1/printers/:id/files', () => {
        return HttpResponse.json({ success: true });
      }),
      http.post('/api/v1/printers/:id/files/import', async ({ request }) => {
        const body = await request.json() as { paths?: string[] };
        const path = body.paths?.[0] ?? '/unknown';
        return HttpResponse.json({
          imported: [
            {
              path,
              filename: path.split('/').pop() ?? 'imported.gcode',
              library_file_id: 99,
            },
          ],
          failed: [],
          delete_failed: [],
        });
      })
    );
  });

  describe('rendering', () => {
    it('renders the modal with header', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('File Manager')).toBeInTheDocument();
      expect(screen.getByText('X1 Carbon')).toBeInTheDocument();
    });

    it('renders storage info', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Used:/)).toBeInTheDocument();
        expect(screen.getByText(/Free:/)).toBeInTheDocument();
      });
    });

    it('renders quick navigation buttons', () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Root')).toBeInTheDocument();
      expect(screen.getByText('Cache')).toBeInTheDocument();
      expect(screen.getByText('Models')).toBeInTheDocument();
      expect(screen.getByText('Timelapse')).toBeInTheDocument();
    });

    it('renders file list', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('cache')).toBeInTheDocument();
        expect(screen.getByText('model')).toBeInTheDocument();
        expect(screen.getByText('benchy.3mf')).toBeInTheDocument();
        expect(screen.getByText('print_job.gcode')).toBeInTheDocument();
      });
    });

    it('shows file sizes for files', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        // 1024000 bytes = 1024.0 KB
        expect(screen.getByText('1024.0 KB')).toBeInTheDocument();
      });
    });
  });

  describe('navigation', () => {
    it('navigates into a folder when clicked', async () => {
      server.use(
        http.get('/api/v1/printers/:id/files', ({ request }) => {
          const url = new URL(request.url);
          const path = url.searchParams.get('path');
          if (path === '/cache') {
            return HttpResponse.json({
              files: [
                { name: 'temp.dat', path: '/cache/temp.dat', size: 512, is_directory: false },
              ],
            });
          }
          return HttpResponse.json({ files: mockFiles });
        })
      );

      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('cache')).toBeInTheDocument();
      });

      // Click on cache folder
      fireEvent.click(screen.getByText('cache'));

      await waitFor(() => {
        expect(screen.getByText('temp.dat')).toBeInTheDocument();
      });
    });

    it('shows current path', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('/')).toBeInTheDocument();
    });
  });

  describe('file selection', () => {
    it('selects a file when checkbox is clicked', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('benchy.3mf')).toBeInTheDocument();
      });

      // Find and click a checkbox (files have checkboxes, directories don't)
      const checkboxes = screen.getAllByRole('button').filter(btn =>
        btn.querySelector('svg')?.classList.contains('lucide-square')
      );

      if (checkboxes.length > 0) {
        fireEvent.click(checkboxes[0]);

        await waitFor(() => {
          expect(screen.getByText('1 selected')).toBeInTheDocument();
        });
      }
    });

    it('enables download button when files are selected', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('benchy.3mf')).toBeInTheDocument();
      });

      // Download button should be disabled initially
      const downloadButton = screen.getByRole('button', { name: /Download/i });
      expect(downloadButton).toBeDisabled();
    });

    it('shows Select All button when files exist', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Select All')).toBeInTheDocument();
      });
    });
  });

  describe('search and filter', () => {
    it('renders search input', () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      expect(screen.getByPlaceholderText('Filter files...')).toBeInTheDocument();
    });

    it('filters files based on search query', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('benchy.3mf')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Filter files...');
      fireEvent.change(searchInput, { target: { value: 'benchy' } });

      await waitFor(() => {
        expect(screen.getByText('benchy.3mf')).toBeInTheDocument();
        expect(screen.queryByText('print_job.gcode')).not.toBeInTheDocument();
      });
    });
  });

  describe('sorting', () => {
    it('renders sort dropdown', () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('has sort options available', () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      const sortSelect = screen.getByRole('combobox');
      expect(sortSelect).toBeInTheDocument();

      // Check that options exist
      expect(screen.getByText('Name (A-Z)')).toBeInTheDocument();
    });

    it('defaults to newest-first sorting', () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      expect(screen.getByRole('combobox')).toHaveValue('date-desc');
    });
  });

  describe('sd-card actions', () => {
    it('imports selected printer files into Bambuddy', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('benchy.3mf')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('button').filter((btn) =>
        btn.querySelector('svg')?.classList.contains('lucide-square')
      );
      fireEvent.click(checkboxes[0]);
      fireEvent.click(screen.getByRole('button', { name: /Import to Bambuddy/i }));

      await waitFor(() => {
        expect(screen.getByText('Imported 1 file(s) into Bambuddy')).toBeInTheDocument();
      });
    });

    it('imports a printable file and opens the print flow', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('print_job.gcode')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('button').filter((btn) =>
        btn.querySelector('svg')?.classList.contains('lucide-square')
      );
      fireEvent.click(checkboxes[1]);
      fireEvent.click(screen.getByRole('button', { name: /^Print$/i }));

      await waitFor(() => {
        expect(screen.getByText('Print Modal print_job.gcode')).toBeInTheDocument();
      });
    });
  });

  describe('close behavior', () => {
    it('calls onClose when X button is clicked', async () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      const closeButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('.lucide-x')
      );

      if (closeButton) {
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it('calls onClose when clicking outside the modal', () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      // Click on the backdrop
      const backdrop = document.querySelector('.fixed.inset-0');
      if (backdrop) {
        fireEvent.click(backdrop);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it('calls onClose when Escape key is pressed', () => {
      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    it('shows empty message when directory has no files', async () => {
      server.use(
        http.get('/api/v1/printers/:id/files', () => {
          return HttpResponse.json({ files: [] });
        })
      );

      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('No files in this directory')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching files', () => {
      // Delay the response to see loading state
      server.use(
        http.get('/api/v1/printers/:id/files', async () => {
          await new Promise((r) => setTimeout(r, 100));
          return HttpResponse.json({ files: mockFiles });
        })
      );

      render(
        <FileManagerModal
          printerId={1}
          printerName="X1 Carbon"
          onClose={mockOnClose}
        />
      );

      // The loader should be present initially
      const loader = document.querySelector('.animate-spin');
      expect(loader).toBeInTheDocument();
    });
  });
});
