import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateCard, getGetBinderQueryKey, getGetBinderStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  setNumber: z.coerce.number().min(1),
  setTotal: z.coerce.number().min(1),
  condition: z.string().min(1),
  currentPriceGBP: z.coerce.number().min(0).optional(),
});

type FormValues = z.infer<typeof schema>;

const CONDITIONS = ["Raw", "PSA 10", "PSA 9", "BGS 10", "CGC 10", "Lightly Played", "Heavily Played"];

export function QuickAddCardDialog({ binderId, setTotal, slotNumber, open, onOpenChange }: { binderId: number, setTotal: number, slotNumber: number | null, open: boolean, onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCard = useCreateCard();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      setNumber: slotNumber || 1,
      setTotal: setTotal,
      condition: "Raw",
      currentPriceGBP: 0,
    }
  });

  // Update default slot when it changes
  if (slotNumber !== null && form.getValues("setNumber") !== slotNumber) {
    form.setValue("setNumber", slotNumber);
    form.setValue("setTotal", setTotal);
  }

  const onSubmit = (data: FormValues) => {
    createCard.mutate({ 
      data: {
        ...data,
        assignedBinderId: binderId
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBinderQueryKey(binderId) });
        queryClient.invalidateQueries({ queryKey: getGetBinderStatsQueryKey(binderId) });
        toast({ title: "Card Registered", description: `Slot ${data.setNumber} filled successfully.` });
        form.reset();
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Registration Failed", variant: "destructive", description: String(err) });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest text-primary flex items-center gap-2">
            Register Card
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Manual entry for slot {slotNumber?.toString().padStart(3, '0')} / {setTotal}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="font-mono uppercase text-[10px] text-muted-foreground">Card Name</Label>
            <Input id="name" {...form.register("name")} className="font-mono bg-background border-border focus-visible:ring-primary" placeholder="e.g. Charizard" />
            {form.formState.errors.name && <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-mono uppercase text-[10px] text-muted-foreground">Condition</Label>
              <Select onValueChange={(val) => form.setValue("condition", val)} defaultValue={form.getValues("condition")}>
                <SelectTrigger className="font-mono bg-background border-border">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currentPriceGBP" className="font-mono uppercase text-[10px] text-muted-foreground">Value (£)</Label>
              <Input id="currentPriceGBP" type="number" step="0.01" {...form.register("currentPriceGBP")} className="font-mono bg-background border-border focus-visible:ring-primary" placeholder="0.00" />
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="font-mono uppercase text-xs">Cancel</Button>
            <Button type="submit" disabled={createCard.isPending} className="font-mono uppercase text-xs">
              {createCard.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save to Vault
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}