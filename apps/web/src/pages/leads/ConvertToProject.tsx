import { formatAud } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, FolderKanban, UserRoundPlus, UserRoundCheck } from 'lucide-react';
import { useState } from 'react';
import { DetailList } from '../../components/DetailList.tsx';
import { LeadIdLink } from '../../components/LeadIdLink.tsx';
import { errorMessage } from '../../lib/errors.ts';
import { useCan } from '../../lib/hooks.ts';
import { useTRPC } from '../../lib/trpc.ts';
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Skeleton,
  toast,
  Tooltip,
} from '../../ui/index.ts';

function Preview({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const preview = useQuery(trpc.projects.conversionPreview.queryOptions({ leadId }));
  const convert = useMutation(trpc.projects.convertLead.mutationOptions());
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    try {
      const project = await convert.mutateAsync({ leadId });
      await queryClient.invalidateQueries();
      toast({ title: `Project ${project.projectRef ?? ''} created`, tone: 'success' });
      onDone();
      void navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  if (preview.isPending) {
    return (
      <DialogBody className="flex flex-col gap-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-24" />
      </DialogBody>
    );
  }
  if (preview.isError) {
    return (
      <DialogBody>
        <Alert tone="danger">{errorMessage(preview.error)}</Alert>
      </DialogBody>
    );
  }
  const { problems, contact, project } = preview.data;
  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        {problems.length > 0 ? (
          <Alert tone="warning" title="This lead can't be converted yet">
            <ul className="list-inside list-disc">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Alert>
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
              {contact.mode === 'existing' ? (
                <UserRoundCheck className="mt-0.5 size-4 text-success" />
              ) : (
                <UserRoundPlus className="mt-0.5 size-4 text-accent-text" />
              )}
              <p>
                {contact.mode === 'existing' ? (
                  <>
                    Linked to the existing contact{' '}
                    <span className="font-medium">{contact.name}</span>.
                  </>
                ) : (
                  <>
                    A new contact <span className="font-medium">{contact.name}</span> will be
                    created.
                  </>
                )}
              </p>
            </div>
            <div className="rounded-lg border border-line px-3">
              <p className="flex items-center gap-2 pt-3 text-sm font-medium">
                <FolderKanban className="size-4 text-fg-muted" />
                New project: {project.title}
              </p>
              <DetailList
                items={[
                  {
                    label: 'Project ID',
                    value: <LeadIdLink value={project.projectRef} label="Project ID" />,
                  },
                  { label: 'Site', value: project.address },
                  { label: 'Stage', value: project.stage },
                  { label: 'Sales person', value: project.salesPerson ?? 'Unassigned' },
                  {
                    label: 'System',
                    value: project.system.length > 0 && (
                      <span className="flex flex-col">
                        {project.system.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                        {project.systemSizeKw && <span>{project.systemSizeKw} kW</span>}
                      </span>
                    ),
                  },
                  { label: 'Selling price', value: formatAud(project.sellingPriceAud) },
                  { label: 'Deposit', value: formatAud(project.depositAud) },
                ]}
              />
            </div>
            <p className="text-sm text-fg-muted">
              This lead will be marked as{' '}
              <span className="font-medium text-fg">Converted to Project</span> and cannot be
              reverted back. Existing files and data will remain on the lead and will also be
              visible in the project.
            </p>
          </>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={problems.length > 0}
          loading={convert.isPending}
          onClick={() => void confirm()}
        >
          Convert to project
          <ArrowRight />
        </Button>
      </DialogFooter>
    </>
  );
}

/** "Convert to project" button + confirmation showing exactly what will be created. */
export function ConvertToProjectButton({
  leadId,
  hasLeadRef = true,
}: {
  leadId: string;
  /** Without a Lead ID there is no Project ID, so the button is off (the API refuses too). */
  hasLeadRef?: boolean;
}) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  if (!can('projects', 'create') || !can('leads', 'edit')) return null;
  const button = (
    <Button
      variant="primary"
      disabled={!hasLeadRef}
      onClick={() => {
        setOpen(true);
      }}
    >
      <FolderKanban />
      Convert to project
    </Button>
  );
  return (
    <>
      {hasLeadRef ? (
        button
      ) : (
        <Tooltip content="Add a Lead ID first (Edit) — it becomes the Project ID.">
          {/* A disabled button gets no pointer events; the wrapper shows the reason. */}
          <span tabIndex={0}>{button}</span>
        </Tooltip>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Convert to project"
          description="Here's what will be created."
          className="max-w-lg"
        >
          {open && (
            <Preview
              leadId={leadId}
              onDone={() => {
                setOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Shown on a converted lead: where the job went. */
export function ConvertedNotice({
  project,
}: {
  project: { id: string; projectRef: string | null };
}) {
  const can = useCan();
  return (
    <Alert
      tone="success"
      title={
        project.projectRef ? `Converted to project ${project.projectRef}` : 'Converted to a project'
      }
    >
      This lead is now a job. Its status is locked.{' '}
      {can('projects', 'view') && (
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          className="font-medium underline"
        >
          Open the project
        </Link>
      )}
    </Alert>
  );
}
