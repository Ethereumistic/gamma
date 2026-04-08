import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Building2, Users2, FolderKanban, ChevronRight, LockKeyhole, ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/features/workspace/context";

export default function OrganizationPage() {
    const { authenticated, isLoadingWorkspace, organizations, projects, selectedOrganizationId, setSelectedOrganizationId } = useWorkspace();
    const navigate = useNavigate();

    if (isLoadingWorkspace) {
        return (
            <div className="flex h-full items-center justify-center bg-background/50 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent shadow-neon-green-sm" />
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.4em] text-primary ml-1">Scanning Directory...</p>
                </div>
            </div>
        );
    }

    if (!authenticated) {
        return (
            <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center p-6 text-center">
                <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-500">
                    <LockKeyhole className="size-8" />
                </div>
                <h2 className="font-display text-2xl font-black uppercase tracking-tight text-white">Registry Restricted</h2>
                <p className="mt-2 text-sm text-slate-500">Authorized personnel only. Please authenticate to view the industrial entity directory.</p>
                <Button asChild className="mt-8 h-12 w-full bg-white text-black hover:bg-white/90 font-bold uppercase tracking-widest transition-all">
                    <Link to="/auth">Initiate Handshake</Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="relative min-h-full overflow-y-auto bg-background px-6 py-12 lg:px-12">
            {/* Background Glow */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />
            </div>

            <div className="relative z-10 mx-auto w-full max-w-[1200px] space-y-12">
                <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between border-b border-white/5 pb-10">
                    <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-[9px] font-bold uppercase tracking-[0.4em] text-primary shadow-neon-green-sm">
                            Authorized Directory
                        </div>
                        <h1 className="font-display text-5xl font-black tracking-tighter text-white lg:text-6xl">
                            Industry <span className="text-glow-white">Authorities</span>
                        </h1>
                        <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
                            Central registry of high-level industrial entities and administrative units linked to your operator profile.
                        </p>
                    </div>
                </header>

                <main className="grid gap-6">
                    {organizations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center rounded-[3rem] border border-dashed border-white/10 bg-white/[0.02] py-40 text-center">
                            <div className="mb-6 flex size-20 items-center justify-center rounded-3xl bg-white/5 text-slate-700">
                                <Building2 className="size-10" />
                            </div>
                            <h3 className="font-display text-xl font-black uppercase tracking-widest text-white">No entities registered</h3>
                            <p className="mt-2 text-sm text-slate-500 uppercase tracking-wider opacity-60">Initialize an organization from the workspace root.</p>
                        </div>
                    ) : (
                        <div className="grid gap-4 lg:grid-cols-2">
                            {organizations.map((org, idx) => {
                                const isSelected = org.id === selectedOrganizationId;
                                
                                return (
                                    <div key={org.id}>
                                        <button
                                            onClick={() => setSelectedOrganizationId(org.id)}
                                            className={`group relative flex w-full flex-col overflow-hidden rounded-[2.5rem] border p-8 text-left transition-all duration-500 ${
                                                isSelected
                                                    ? "border-primary/40 bg-primary/5 shadow-neon-green-sm"
                                                    : "border-white/5 bg-black/40 hover:bg-white/[0.03] hover:border-white/10"
                                            }`}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex gap-6">
                                                    <div className="flex size-20 items-center justify-center rounded-[1.5rem] border border-white/10 bg-black/60 text-4xl shadow-inner transition-transform group-hover:scale-105 group-hover:rotate-3">
                                                        {org.icon || "🏢"}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <h3 className="font-display text-2xl font-black text-white group-hover:text-primary transition-colors">
                                                            {org.name}
                                                        </h3>
                                                        <div className="flex items-center gap-3 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                                            <LockKeyhole className="size-3" />
                                                            Clearance Tier: {org.role}
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                <div className={`rounded-xl border p-2 backdrop-blur-sm transition-all ${
                                                    isSelected ? "border-primary/40 bg-primary/10 text-primary" : "border-white/5 bg-white/5 text-slate-600"
                                                }`}>
                                                    <ArrowUpRight className="size-5" />
                                                </div>
                                            </div>

                                            <div className="mt-8 grid grid-cols-2 gap-4">
                                                <div className="flex items-center gap-4 rounded-2xl border border-white/5 bg-black/40 p-5 transition-colors group-hover:bg-white/[0.02]">
                                                    <div className="flex size-10 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-slate-400 group-hover:text-primary transition-colors">
                                                        <FolderKanban className="size-5" />
                                                    </div>
                                                    <div>
                                                        <p className="text-xl font-black text-white">{org.projectCount}</p>
                                                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Active Silos</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4 rounded-2xl border border-white/5 bg-black/40 p-5 transition-colors group-hover:bg-white/[0.02]">
                                                    <div className="flex size-10 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-slate-400 group-hover:text-primary transition-colors">
                                                        <Users2 className="size-5" />
                                                    </div>
                                                    <div>
                                                        <p className="text-xl font-black text-white">{org.memberCount}</p>
                                                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Operators</p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-6">
                                                <div className="flex -space-x-2">
                                                    {[...Array(Math.min(3, org.memberCount))].map((_, i) => (
                                                        <div key={i} className="size-7 rounded-full border-2 border-background bg-slate-800 ring-2 ring-white/5" />
                                                    ))}
                                                    {org.memberCount > 3 && (
                                                        <div className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-slate-900 text-[10px] font-black text-slate-400 ring-2 ring-white/5">
                                                            +{org.memberCount - 3}
                                                        </div>
                                                    )}
                                                </div>
                                                
                                                <Button 
                                                    variant="ghost" 
                                                    className="h-9 px-6 text-[10px] uppercase font-bold tracking-widest text-slate-500 hover:text-white hover:bg-white/5"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigate(`/organization/${org.id}`);
                                                    }}
                                                >
                                                    Entity Settings
                                                </Button>
                                            </div>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
