import { zodResolver } from '@hookform/resolvers/zod';
import { stcSettingsSchema, type StcSettingsInput, type StcSettingsValues } from '@mms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '../../../components/PageHeader.tsx';
import { errorMessage } from '../../../lib/errors.ts';
import { useIsAdmin } from '../../../lib/hooks.ts';
import { useTRPC, type RouterOutputs } from '../../../lib/trpc.ts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardFooter,
  EmptyState,
  FormField,
  Input,
  Skeleton,
  textInput,
  toast,
} from '../../../ui/index.ts';
import { SettingsBackLink } from '../SettingsPage.tsx';

type Settings = RouterOutputs['admin']['stcSettings']['get'];

const FIELDS: { name: keyof StcSettingsInput; label: string; hint: string }[] = [
  {
    name: 'customerRateAud',
    label: 'Customer rate per STC',
    hint: 'What the customer is credited per certificate.',
  },
  {
    name: 'internalRateAud',
    label: 'Internal rate per STC',
    hint: 'What the business receives per certificate. STC amounts on projects and the dashboard use it.',
  },
  {
    name: 'adminChargesAud',
    label: 'Admin charges',
    hint: "Taken off each job's STC money received.",
  },
];

function StcSettingsForm({ settings }: { settings: Settings }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const save = useMutation(trpc.admin.stcSettings.save.mutationOptions());
  const [error, setError] = useState<string | null>(null);
  const form = useForm<StcSettingsInput, unknown, StcSettingsValues>({
    resolver: zodResolver(stcSettingsSchema),
    defaultValues: {
      customerRateAud: settings.customerRateAud ?? '',
      internalRateAud: settings.internalRateAud ?? '',
      adminChargesAud: settings.adminChargesAud ?? '',
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await save.mutateAsync(values);
      await Promise.all([
        queryClient.invalidateQueries(trpc.admin.stcSettings.pathFilter()),
        queryClient.invalidateQueries(trpc.projects.pathFilter()),
        queryClient.invalidateQueries(trpc.dashboard.pathFilter()),
      ]);
      toast({ title: 'STC settings saved', tone: 'success' });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {error && (
            <Alert tone="danger" className="sm:col-span-2">
              {error}
            </Alert>
          )}
          {FIELDS.map((spec) => (
            <FormField
              key={spec.name}
              control={form.control}
              name={spec.name}
              label={spec.label}
              hint={spec.hint}
            >
              {(field, props) => (
                <Input {...props} {...textInput(field)} inputMode="decimal" placeholder="0.00" />
              )}
            </FormField>
          ))}
        </CardContent>
        <CardFooter>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            Save
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

/** Settings → STC settings: the business-wide STC rates and charges. Admin only. */
export function StcSettingsPage() {
  const trpc = useTRPC();
  const isAdmin = useIsAdmin();
  const query = useQuery({ ...trpc.admin.stcSettings.get.queryOptions(), enabled: isAdmin });
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsBackLink />
      <PageHeader
        title="STC settings"
        description="Set once for every project. Only Admins can see or change these."
      />
      {!isAdmin ? (
        <Card>
          <EmptyState
            icon={<Lock />}
            title="Admin only"
            description="Only an Admin can see or change the STC rates and charges."
          />
        </Card>
      ) : query.isPending ? (
        <Skeleton className="h-64" />
      ) : query.isError ? (
        <Alert tone="danger">{errorMessage(query.error)}</Alert>
      ) : (
        <StcSettingsForm settings={query.data} />
      )}
    </div>
  );
}
