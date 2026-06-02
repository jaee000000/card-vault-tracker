import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateBinder, getListBindersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  setCode: z.string().min(1, "Set Code is required").max(10),
  setTotal: z.coerce.number().min(1, "Set Total must be at least 1")
});

type FormValues = z.infer<typeof schema>;

export function AddBinderDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBinder = useCreateBinder();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      setCode: "",
      setTotal: 100
    }
  });

  const onSubmit = (data: FormValues) => {
    createBinder.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBindersQueryKey() });
        toast({ title: "Binder initialized", description: `Created folder for ${data.name}` });
        form.reset();
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Failed to initialize binder", variant: "destructive", description: String(err) });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest text-primary flex items-center gap-2">
            <div className="w-2 h-2 bg-primary animate-pulse" />
            Initialize Binder
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Create a new vault partition for a card expansion.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="font-mono uppercase text-[10px] text-muted-foreground">Binder Name</Label>
            <Input id="name" {...form.register("name")} className="font-mono bg-background border-border focus-visible:ring-primary" placeholder="e.g. Base Set" />
            {form.formState.errors.name && <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="setCode" className="font-mono uppercase text-[10px] text-muted-foreground">Set Code</Label>
              <Input id="setCode" {...form.register("setCode")} className="font-mono bg-background border-border focus-visible:ring-primary uppercase" placeholder="BS" />
              {form.formState.errors.setCode && <p className="text-destructive text-xs">{form.formState.errors.setCode.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="setTotal" className="font-mono uppercase text-[10px] text-muted-foreground">Set Total</Label>
              <Input id="setTotal" type="number" {...form.register("setTotal")} className="font-mono bg-background border-border focus-visible:ring-primary" placeholder="102" />
              {form.formState.errors.setTotal && <p className="text-destructive text-xs">{form.formState.errors.setTotal.message}</p>}
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="font-mono uppercase text-xs">Cancel</Button>
            <Button type="submit" disabled={createBinder.isPending} className="font-mono uppercase text-xs">
              {createBinder.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Execute
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}