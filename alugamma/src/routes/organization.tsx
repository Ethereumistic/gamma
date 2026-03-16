import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useWorkspace } from "@/features/workspace/context";

export default function OrganizationPage() {
    const { authenticated, isLoadingWorkspace, organizations, projects } = useWorkspace();

    if (isLoadingWorkspace) {
        return (
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
                <Card className="border-white/10 bg-card/85">
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading...</CardContent>
                </Card>
            </div>
        );
    }

    if (!authenticated) {
        return (
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
                <Card className="border-white/10 bg-card/85">
                    <CardHeader>
                        <CardTitle>Sign in required</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm text-muted-foreground">
                        <p>You need to be signed in to view your organizations.</p>
                        <Button asChild>
                            <Link to="/auth">Sign in</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-10 lg:px-8">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
            </div>

            {organizations.length === 0 ? (
                <Card className="border-white/10 bg-card/85">
                    <CardHeader>
                        <CardTitle>No organizations found</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        You are not a member of any organizations yet.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {organizations.map((org) => {
                        const orgProjects = projects.filter(p => p.organizationId === org.id);
                        return (
                            <Card key={org.id} className="border-white/10 bg-card/85 transition-colors hover:bg-card/95">
                                <CardHeader className="pb-4">
                                    <CardTitle className="flex items-center justify-between">
                                        <span className="truncate">{org.name}</span>
                                        <span className="flex-shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                            {org.role}
                                        </span>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-4">
                                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                                        <span>{org.memberCount} member{org.memberCount !== 1 && "s"}</span>
                                        <span>{org.projectCount} project{org.projectCount !== 1 && "s"}</span>
                                    </div>

                                    {orgProjects.length > 0 && (
                                        <Accordion type="single" collapsible className="w-full">
                                            <AccordionItem value="projects" className="border-white/10 border-b-0">
                                                <AccordionTrigger className="py-2 text-sm hover:no-underline">
                                                    View Projects
                                                </AccordionTrigger>
                                                <AccordionContent>
                                                    <div className="flex flex-col gap-2 pt-2">
                                                        {orgProjects.map(project => (
                                                            <div key={project.id} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2 text-sm">
                                                                <span className="truncate flex-1">{project.name}</span>
                                                                <Button asChild variant="ghost" size="sm" className="h-6 px-2 ml-2">
                                                                    <Link to={`/project/${project.id}`}>Open</Link>
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </AccordionContent>
                                            </AccordionItem>
                                        </Accordion>
                                    )}

                                    <Button asChild variant="secondary" className="w-full">
                                        <Link to={`/organization/${org.id}`}>View Organization Settings</Link>
                                    </Button>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
