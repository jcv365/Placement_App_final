"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SuccessBanner } from "@/components/ui/success-banner";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/client";
import * as React from "react";

type ClientAccount = {
  id: string;
  name: string;
  domain: string | null;
  contractTerms: string | null;
  billingNotes: string | null;
  isActive: boolean;
  _count?: {
    contacts: number;
    vacancies: number;
  };
};

type ClientContact = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: "HIRING_MANAGER" | "BILLING" | "LEGAL" | "OTHER";
  notes: string | null;
  clientAccount: {
    id: string;
    name: string;
  };
};

type Vacancy = {
  id: string;
  title: string;
  stage:
    | "OPEN"
    | "SCREENING"
    | "INTERVIEW"
    | "OFFER"
    | "FILLED"
    | "ON_HOLD"
    | "CLOSED";
  clientAccount: {
    id: string;
    name: string;
  };
};

const SAMPLE_ACCOUNTS: ClientAccount[] = [
  {
    id: "sample-client-1",
    name: "Acme Consulting",
    domain: "acme.example",
    contractTerms: "Outside IR35 preferred, 3-month rolling.",
    billingNotes: "Invoice weekly.",
    isActive: true,
    _count: { contacts: 1, vacancies: 1 },
  },
  {
    id: "sample-client-2",
    name: "Northwind Engineering",
    domain: "northwind.example",
    contractTerms: "Inside IR35 possible depending on scope.",
    billingNotes: "Invoice monthly.",
    isActive: true,
    _count: { contacts: 1, vacancies: 1 },
  },
];

export default function ClientsClient() {
  const [accounts, setAccounts] = React.useState<ClientAccount[]>([]);
  const [contacts, setContacts] = React.useState<ClientContact[]>([]);
  const [vacancies, setVacancies] = React.useState<Vacancy[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedAccountId, setSelectedAccountId] = React.useState<
    string | null
  >(null);

  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "active">(
    "all",
  );

  const [accountName, setAccountName] = React.useState("");
  const [accountDomain, setAccountDomain] = React.useState("");
  const [contractTerms, setContractTerms] = React.useState("");
  const [billingNotes, setBillingNotes] = React.useState("");
  const [accountSaving, setAccountSaving] = React.useState(false);

  const [contactAccountId, setContactAccountId] = React.useState("");
  const [contactName, setContactName] = React.useState("");
  const [contactEmail, setContactEmail] = React.useState("");
  const [contactPhone, setContactPhone] = React.useState("");
  const [contactRole, setContactRole] = React.useState<
    "HIRING_MANAGER" | "BILLING" | "LEGAL" | "OTHER"
  >("HIRING_MANAGER");
  const [contactNotes, setContactNotes] = React.useState("");
  const [contactSaving, setContactSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 3000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [successMessage]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [accountData, contactData, vacancyData] = await Promise.all([
        fetchJson<ClientAccount[]>("/api/client-accounts"),
        fetchJson<ClientContact[]>("/api/client-contacts"),
        fetchJson<Vacancy[]>("/api/vacancies"),
      ]);
      setAccounts(accountData);
      setContacts(contactData);
      setVacancies(vacancyData);

      if (!selectedAccountId && accountData[0]?.id) {
        setSelectedAccountId(accountData[0].id);
      }
      if (!contactAccountId && accountData[0]?.id) {
        setContactAccountId(accountData[0].id);
      }
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId, contactAccountId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const filteredAccounts = React.useMemo(() => {
    return accounts.filter((account) => {
      if (statusFilter === "active" && !account.isActive) {
        return false;
      }
      if (!search.trim()) {
        return true;
      }
      const term = search.trim().toLowerCase();
      return (
        account.name.toLowerCase().includes(term) ||
        (account.domain ?? "").toLowerCase().includes(term)
      );
    });
  }, [accounts, search, statusFilter]);

  const accountsToDisplay =
    filteredAccounts.length > 0 || accounts.length > 0
      ? filteredAccounts
      : SAMPLE_ACCOUNTS;

  React.useEffect(() => {
    if (!selectedAccountId && filteredAccounts[0]?.id) {
      setSelectedAccountId(filteredAccounts[0].id);
      return;
    }
    if (
      selectedAccountId &&
      !filteredAccounts.some((account) => account.id === selectedAccountId)
    ) {
      setSelectedAccountId(filteredAccounts[0]?.id ?? null);
    }
  }, [filteredAccounts, selectedAccountId]);

  const selectedAccount =
    accountsToDisplay.find((account) => account.id === selectedAccountId) ??
    null;
  const selectedContacts = contacts.filter(
    (contact) => contact.clientAccount.id === selectedAccountId,
  );
  const selectedVacancies = vacancies.filter(
    (vacancy) => vacancy.clientAccount.id === selectedAccountId,
  );

  const handleCreateAccount = async () => {
    if (accountName.trim().length < 2) {
      setFormError("Client account name must be at least 2 characters.");
      return;
    }

    setFormError(null);
    setSuccessMessage(null);
    setAccountSaving(true);
    try {
      await fetchJson("/api/client-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: accountName,
          domain: accountDomain,
          contractTerms,
          billingNotes,
          isActive: true,
        }),
      });

      setAccountName("");
      setAccountDomain("");
      setContractTerms("");
      setBillingNotes("");
      await load();
      setSuccessMessage("Client account created.");
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setAccountSaving(false);
    }
  };

  const handleCreateContact = async () => {
    if (!contactAccountId) {
      setFormError("Select a client account first.");
      return;
    }
    if (!contactName.trim()) {
      setFormError("Contact full name is required.");
      return;
    }
    if (!contactEmail.includes("@")) {
      setFormError("Enter a valid contact email.");
      return;
    }

    setFormError(null);
    setSuccessMessage(null);
    setContactSaving(true);
    try {
      await fetchJson("/api/client-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientAccountId: contactAccountId,
          fullName: contactName,
          email: contactEmail,
          phone: contactPhone,
          role: contactRole,
          notes: contactNotes,
        }),
      });

      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setContactRole("HIRING_MANAGER");
      setContactNotes("");
      await load();
      setSuccessMessage("Client contact created.");
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setContactSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError ? <ErrorBanner message={loadError} /> : null}
      {formError ? <ErrorBanner message={formError} /> : null}
      {successMessage ? <SuccessBanner message={successMessage} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Clients</h1>
          <p className="text-sm text-slate-600">
            Manage client accounts, contacts, and vacancy relationships.
          </p>
        </div>
        <Button onClick={handleCreateAccount} disabled={accountSaving}>
          {accountSaving ? "Creating..." : "Create client account"}
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-4 md:grid-cols-[1fr_auto_auto]">
          <Input
            placeholder="Search by client name or domain"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "all" | "active")
            }
          >
            <option value="all">All accounts</option>
            <option value="active">Active only</option>
          </select>
          <Button
            className="border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            onClick={() => setSearch("")}
          >
            Clear
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Client accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {accountsToDisplay.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                No client accounts found. Create your first client to begin.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2">Client</th>
                      <th className="px-2 py-2">Domain</th>
                      <th className="px-2 py-2">Linked records</th>
                      <th className="px-2 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountsToDisplay.map((account) => {
                      const selected = account.id === selectedAccountId;
                      return (
                        <tr
                          key={account.id}
                          className="border-b border-slate-100"
                        >
                          <td className="px-2 py-2 font-medium text-slate-900">
                            {account.name}
                          </td>
                          <td className="px-2 py-2 text-slate-700">
                            {account.domain || "No domain set"}
                          </td>
                          <td className="px-2 py-2">
                            <Badge>
                              {(account._count?.contacts ?? 0) +
                                (account._count?.vacancies ?? 0)}{" "}
                              linked
                            </Badge>
                            {!accounts.length ? (
                              <Badge className="ml-2">Sample</Badge>
                            ) : null}
                          </td>
                          <td className="px-2 py-2">
                            <Button
                              className={
                                selected
                                  ? "h-8 px-2 text-xs"
                                  : "h-8 border border-slate-300 bg-white px-2 text-xs text-slate-900 hover:bg-slate-50"
                              }
                              onClick={() => setSelectedAccountId(account.id)}
                            >
                              {selected ? "Selected" : "View details"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Client detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedAccount ? (
              <p className="text-sm text-slate-600">
                Select a client account to view details.
              </p>
            ) : (
              <>
                <div className="rounded-md border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">
                    {selectedAccount.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    Domain: {selectedAccount.domain || "Not set"}
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    {selectedAccount.contractTerms ||
                      "No contract terms recorded."}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-900">Contacts</p>
                  {selectedContacts.length === 0 ? (
                    <p className="mt-1 text-sm text-slate-600">
                      No contacts added for this account.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm text-slate-700">
                      {selectedContacts.map((contact) => (
                        <li
                          key={contact.id}
                          className="rounded-md border border-slate-200 p-2"
                        >
                          <p className="font-medium text-slate-900">
                            {contact.fullName}
                          </p>
                          <p className="text-xs text-slate-600">
                            {contact.email}
                          </p>
                          <p className="text-xs text-slate-500">
                            {contact.role.replace(/_/g, " ")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Vacancies
                  </p>
                  {selectedVacancies.length === 0 ? (
                    <p className="mt-1 text-sm text-slate-600">
                      No vacancies linked to this client.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm text-slate-700">
                      {selectedVacancies.map((vacancy) => (
                        <li
                          key={vacancy.id}
                          className="rounded-md border border-slate-200 p-2"
                        >
                          <p className="font-medium text-slate-900">
                            {vacancy.title}
                          </p>
                          <p className="text-xs text-slate-500">
                            {vacancy.stage.replace(/_/g, " ")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add client contact</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm md:col-span-2"
            value={contactAccountId}
            onChange={(event) => setContactAccountId(event.target.value)}
          >
            <option value="">Select client account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <Input
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            placeholder="Contact full name"
            className={contactName.trim() ? undefined : "border-red-300"}
          />
          <Input
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="Contact email"
            className={
              contactEmail.includes("@") ? undefined : "border-red-300"
            }
          />
          <Input
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            placeholder="Contact number"
          />
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={contactRole}
            onChange={(event) =>
              setContactRole(
                event.target.value as
                  | "HIRING_MANAGER"
                  | "BILLING"
                  | "LEGAL"
                  | "OTHER",
              )
            }
          >
            <option value="HIRING_MANAGER">Hiring manager</option>
            <option value="BILLING">Billing</option>
            <option value="LEGAL">Legal</option>
            <option value="OTHER">Other</option>
          </select>
          <Textarea
            value={contactNotes}
            onChange={(event) => setContactNotes(event.target.value)}
            placeholder="Contact notes"
            className="md:col-span-2"
          />
          <div className="md:col-span-2">
            <Button onClick={handleCreateContact} disabled={contactSaving}>
              {contactSaving ? "Saving..." : "Create contact"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create client account details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Input
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            placeholder="Client account name"
          />
          <Input
            value={accountDomain}
            onChange={(event) => setAccountDomain(event.target.value)}
            placeholder="Domain (optional)"
          />
          <Textarea
            value={contractTerms}
            onChange={(event) => setContractTerms(event.target.value)}
            placeholder="Contract terms"
            className="md:col-span-2"
          />
          <Textarea
            value={billingNotes}
            onChange={(event) => setBillingNotes(event.target.value)}
            placeholder="Billing notes"
            className="md:col-span-2"
          />
        </CardContent>
      </Card>
    </div>
  );
}
