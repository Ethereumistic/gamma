import { useSearchParams } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function NavbarBreadcrumb() {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <div className="flex flex-1 items-center justify-between gap-4">
      <div className="flex items-center gap-4 mt-0.5">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/organization">Organization</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Project Details</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Columns
        </span>
        <Select
          value={searchParams.get("cols") || "3"}
          onValueChange={(val) => {
            setSearchParams((prev) => {
              prev.set("cols", val);
              return prev;
            });
          }}
        >
          <SelectTrigger className="h-8 w-[80px] bg-black/20 text-xs">
            <SelectValue placeholder="Cols" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">x1</SelectItem>
            <SelectItem value="2">x2</SelectItem>
            <SelectItem value="3">x3</SelectItem>
            <SelectItem value="4">x4</SelectItem>
            <SelectItem value="5">x5</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
