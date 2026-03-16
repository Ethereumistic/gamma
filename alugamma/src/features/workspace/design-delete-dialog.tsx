import { useNavigate, useLocation } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useDesignDelete } from "@/features/workspace/design-delete-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DesignDeleteDialog() {
  const navigate = useNavigate();
  const location = useLocation();
  const { designToDelete, setDesignToDelete } = useDesignDelete();
  const deleteDesign = useMutation(api.designs.deleteDesign);

  return (
    <AlertDialog open={!!designToDelete} onOpenChange={(open) => !open && setDesignToDelete(null)}>
      <AlertDialogContent className="border-white/10 bg-[#090d16] text-white sm:max-w-[425px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">Delete design</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            Are you sure you want to delete this design? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/10 bg-transparent text-white hover:bg-white/5">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-500 text-white hover:bg-red-600 border-none"
            onClick={async () => {
              if (designToDelete) {
                await deleteDesign({ designId: designToDelete });
                if (location.pathname === `/sheet-metal/${designToDelete}`) {
                  navigate("/sheet-metal/new");
                }
                setDesignToDelete(null);
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
