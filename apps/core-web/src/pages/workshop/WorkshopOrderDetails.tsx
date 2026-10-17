import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useCatalogProviderSettings } from "@/api/useCatalogProviderSettings";
import { useVehicle, useResolveVehicleIdentity } from "@/api/vehicles";
import { FitmentSearchModal } from "@/components/workshop/FitmentSearchModal";
import { VehicleIdentityBanner } from "@/components/workshop/VehicleIdentityBanner";
import { WorkshopCommunicationTimeline } from "@/components/workshop/WorkshopCommunicationTimeline";
import { WorkshopReadyEmailNotice } from "@/components/workshop/WorkshopReadyEmailNotice";
import { WorkshopEstimateCard } from "@/components/workshop/WorkshopEstimateCard";
import { MechanicFindingAdvisorPanel } from "@/components/workshop/MechanicFindingAdvisorPanel";
import { ResumeWaitingTasksPanel } from "@/components/workshop/ResumeWaitingTasksPanel";
import { InvoiceOverrunWarning } from "@/components/workshop/InvoiceOverrunWarning";
import { canManageWorkshopEstimates } from "@/features/workshop/workshop-estimate-permissions";
import { TyreSetsSummary } from "@/features/tyre-storage/TyreSetsSummary";
import { WorkshopOrderMeasurementsSection } from "@/components/workshop/WorkshopOrderMeasurementsSection";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useCreateWorkshopTask,
  useDeleteWorkshopTask,
  useUpdateWorkshopOrder,
  useUpdateWorkshopTask,
  useWorkshopOrder,
  useGenerateWorkshopPdf,
  downloadWorkshopPdf,
  useWorkshopResources,
  useAssignBoard,
  workshopKeys,
} from "@/api/workshop";
import type {
  WorkshopOrder,
  WorkshopTask,
  WorkshopTaskStatus,
} from "@/api/types";
import { OrderTopBar, CustomerVehicleInfo } from "./components/OrderHeader";
import { TaskList } from "./components/TaskList";
import { CheckoutFooter } from "./components/CheckoutFooter";
import { useWorkshopCheckout } from "./hooks/useWorkshopCheckout";
import { useWorkshopTaskLineItems } from "./hooks/useWorkshopTaskLineItems";
import { triggerBlobDownload } from "@/lib/download";
import { getErrorMessage } from "./utils/error";
import {
  RecordPickerlDialog,
  formatLocalDateInput,
} from "@/components/vehicles/RecordPickerlDialog";
import { useAuthSession } from "@/api/auth-session";
import { useVehicleInspectionRecords } from "@/api/vehicle-inspection-records";
import { canRecordVehicleInspection } from "@/components/vehicles/vehicle-pickerl-permissions";
import { PICKERL_TASK_TITLE } from "@/features/workshop/pickerl.constants";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  createEmptyCatalogSearchSession,
  findOemConcernForMakeBrandId,
  isVehicleIdentityStale,
  type CatalogSearchSession,
  type CatalogSourceMetadata,
} from "@/features/workshop/catalog-source-copy";

/** The tasks the customer still has to answer. Their work does not go on until the advisor resumes them (AUT-355). */
function countWaitingTasks(tasks: ReadonlyArray<{ status: string }> | null | undefined): number {
  return (tasks ?? []).filter((task) => task.status === "WAITING_CUSTOMER").length;
}

export function WorkshopOrderDetails() {
  const { t } = useTranslation("workshop");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id = "" } = useParams<{ id: string }>();
  const { data: order, isLoading } = useWorkshopOrder(id);
  useDocumentTitle(order?.order_number);
  const workshopResourcesQuery = useWorkshopResources();
  const workshopResources = workshopResourcesQuery?.data;

  const updateOrder = useUpdateWorkshopOrder();
  const assignBoard = useAssignBoard();
  const createTask = useCreateWorkshopTask();
  const deleteTask = useDeleteWorkshopTask();
  const updateTask = useUpdateWorkshopTask();
  const generateWorkshopPdf = useGenerateWorkshopPdf();
  const resolveIdentity = useResolveVehicleIdentity();

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [taskPendingDelete, setTaskPendingDelete] =
    useState<WorkshopTask | null>(null);
  const [catalogSearchSession, setCatalogSearchSession] =
    useState<CatalogSearchSession>(createEmptyCatalogSearchSession);
  const [fitmentSearchTaskId, setFitmentSearchTaskId] = useState<string | null>(
    null,
  );
  const [recordPickerlOpen, setRecordPickerlOpen] = useState(false);
  const [recordPickerlInspectedOn, setRecordPickerlInspectedOn] =
    useState<string>();
  const promptedPickerlTaskIds = useRef(new Set<string>());

  const isLocked = order?.status === "INVOICED";

  const {
    taskLineItemOverrides,
    handleTaskLineItemsChange,
    clearTaskLineItemOverrides,
  } = useWorkshopTaskLineItems({
    orderId: order?.id,
    isLocked: !!isLocked,
    getTasks: () => checkout.tasks,
  });

  const checkout = useWorkshopCheckout({
    order,
    taskLineItemOverrides,
    onReopenTask: setExpandedTaskId,
  });

  const { data: vehicleIdentity } = useVehicle(order?.vehicle?.id ?? "");
  const sessionQuery = useAuthSession();
  const inspectionRecordsQuery = useVehicleInspectionRecords(
    order?.vehicle?.id ?? "",
  );
  const canManagePickerl = canRecordVehicleInspection(
    sessionQuery.data?.activeRole,
  );
  const completedPickerlTask = checkout.tasks.find(
    (task) => task.title === PICKERL_TASK_TITLE && task.status === "DONE",
  );
  useEffect(() => {
    if (
      !completedPickerlTask ||
      !canManagePickerl ||
      inspectionRecordsQuery.isLoading ||
      promptedPickerlTaskIds.current.has(completedPickerlTask.id)
    )
      return;

    const completedAt = Date.parse(completedPickerlTask.updatedAt ?? "");
    const hasRecordForCompletedTask = inspectionRecordsQuery.data?.some(
      (record) =>
        Number.isFinite(completedAt) &&
        Date.parse(record.createdAt) >= completedAt,
    );
    if (hasRecordForCompletedTask) return;

    promptedPickerlTaskIds.current.add(completedPickerlTask.id);
    setRecordPickerlInspectedOn(formatLocalDateInput(new Date()));
    setRecordPickerlOpen(true);
  }, [
    canManagePickerl,
    completedPickerlTask,
    inspectionRecordsQuery.data,
    inspectionRecordsQuery.isLoading,
  ]);
  const { data: catalogProviderSettings } = useCatalogProviderSettings();
  const oemConcern = findOemConcernForMakeBrandId(
    vehicleIdentity?.make_brand_id,
    catalogProviderSettings?.oemConcerns,
  );
  const isIdentityStale = isVehicleIdentityStale(vehicleIdentity);
  const canManageEstimates = canManageWorkshopEstimates(
    sessionQuery.data?.activeRole,
  );

  if (isLoading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {t("orderDetail.loading")}
      </div>
    );
  }

  if (!order) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            {t("orderDetail.notFoundTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            {t("orderDetail.notFoundDescription")}
          </p>
          <Button onClick={() => navigate("/workshop/orders")}>
            {t("orderDetail.backToOrders")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const canAssignTech =
    order.status === "SCHEDULED" ||
    order.status === "INTAKE" ||
    order.status === "IN_PROGRESS";
  const canDeleteTasks = !isLocked && !checkout.hasLinkedInvoice;

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSaveNotes = async (nextNotes: string) => {
    if (isLocked) return;
    if (nextNotes === (order.notes ?? "")) return;
    try {
      await updateOrder.mutateAsync({ id: order.id, notes: nextNotes });
      toast.success(t("orderDetail.toast.notesSaved"));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("orderDetail.toast.notesSaveFailed")));
    }
  };

  const handleSaveReportedIssue = async (nextIssue: string) => {
    if (isLocked) return;
    if (nextIssue === (order.reportedIssue || order.reported_issue || ""))
      return;
    try {
      await updateOrder.mutateAsync({
        id: order.id,
        reportedIssue: nextIssue,
      });
      toast.success(t("orderDetail.toast.reportedIssueSaved"));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("orderDetail.toast.reportedIssueSaveFailed")));
    }
  };

  const handleAddTask = async () => {
    if (isLocked) return;
    const title = newTaskTitle.trim();
    if (!title) return;

    try {
      const created = await createTask.mutateAsync({
        orderId: order.id,
        title,
      });
      setNewTaskTitle("");
      setExpandedTaskId(created.id);
      toast.success(t("orderDetail.toast.taskCreated"));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("orderDetail.toast.taskCreateFailed")));
    }
  };

  const handleTaskStatusChange = async (
    taskId: string,
    status: WorkshopTaskStatus,
  ) => {
    if (isLocked) return;
    try {
      await updateTask.mutateAsync({ orderId: order.id, taskId, status });
      const task = checkout.tasks.find((candidate) => candidate.id === taskId);
      if (
        status === "DONE" &&
        task?.title === PICKERL_TASK_TITLE &&
        canManagePickerl
      ) {
        setRecordPickerlInspectedOn(formatLocalDateInput(new Date()));
        setRecordPickerlOpen(true);
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("orderDetail.toast.taskStatusUpdateFailed")));
    }
  };

  const handleTaskMechanicNotesChange = async (
    taskId: string,
    notes: string,
  ) => {
    if (isLocked) return;
    try {
      await updateTask.mutateAsync({
        orderId: order.id,
        taskId,
        mechanicNotes: notes,
      });
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("orderDetail.toast.mechanicNotesUpdateFailed")));
    }
  };

  const handleToggleTask = async (taskId: string, checked: boolean) => {
    await handleTaskStatusChange(taskId, checked ? "DONE" : "IN_PROGRESS");
  };

  const handleDeleteTask = async () => {
    if (!taskPendingDelete || !canDeleteTasks) return;

    try {
      await deleteTask.mutateAsync({
        orderId: order.id,
        taskId: taskPendingDelete.id,
      });
      if (expandedTaskId === taskPendingDelete.id) {
        setExpandedTaskId(null);
      }
      clearTaskLineItemOverrides(taskPendingDelete.id);
      setTaskPendingDelete(null);
      toast.success(t("orderDetail.toast.taskDeleted"));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("orderDetail.toast.taskDeleteFailed")));
    }
  };

  const handlePrint = async () => {
    const toastId = toast.loading(t("orderDetail.toast.jobCardPdfGenerating"));
    try {
      const res = await generateWorkshopPdf.mutateAsync(order.id);
      if (res.enqueued) {
        toast.success(t("orderDetail.toast.jobCardPdfQueued"), { id: toastId });
        return;
      }

      const blob = await downloadWorkshopPdf(order.id);
      const fileName = `job-card-${order.order_number || order.id}`
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();

      triggerBlobDownload(blob, `${fileName}.pdf`);
      toast.success(t("orderDetail.toast.jobCardPdfDownloaded"), { id: toastId });
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("orderDetail.toast.jobCardPdfFailed")), {
        id: toastId,
      });
    }
  };

  const assignedTechName =
    workshopResources?.mechanics.find(
      (mechanic) => mechanic.id === (order.mechanicId ?? order.mechanic_id),
    )?.name ?? null;
  const assignedTechId = order.mechanicId ?? order.mechanic_id ?? null;
  const activeMechanics =
    workshopResources?.mechanics
      .filter((mechanic) => mechanic.isActive)
      .map((mechanic) => ({ id: mechanic.id, name: mechanic.name })) ?? [];
  const assignedBayName =
    workshopResources?.bays.find(
      (bay) => bay.id === (order.bayId ?? order.bay_id),
    )?.name ?? null;

  const handleAssignedTechChange = async (mechanicId: string | null) => {
    if (!canAssignTech) return;

    const currentMechanicId = order.mechanicId ?? order.mechanic_id ?? null;
    if (mechanicId === currentMechanicId) return;

    const previousOrder = queryClient.getQueryData<WorkshopOrder>(
      workshopKeys.detail(order.id),
    );

    queryClient.setQueryData<WorkshopOrder>(workshopKeys.detail(order.id), {
      ...order,
      mechanicId,
      mechanic_id: mechanicId,
    });

    try {
      await assignBoard.mutateAsync({ orderId: order.id, mechanicId });
      toast.success(
        mechanicId
          ? t("orderDetail.toast.technicianAssigned")
          : t("orderDetail.toast.technicianUnassigned"),
      );
    } catch (error: unknown) {
      if (previousOrder) {
        queryClient.setQueryData(workshopKeys.detail(order.id), previousOrder);
      }
      toast.error(getErrorMessage(error, t("orderDetail.toast.technicianAssignFailed")));
    }
  };

  const handleCatalogSearchSessionUpdate = (
    metadata: CatalogSourceMetadata,
  ) => {
    setCatalogSearchSession((previous) => ({
      ...previous,
      [metadata.concern === "PARTS" ? "parts" : "labor"]: metadata,
    }));
  };

  const handleOpenFitmentSearch = (taskId: string) => {
    setFitmentSearchTaskId(taskId);
  };

  const handleRequestResolveIdentity = () => {
    setFitmentSearchTaskId(null);
    const vehicleId = order.vehicle.id;
    if (!vehicleId) return;
    void resolveIdentity
      .mutateAsync(vehicleId)
      .then(() => {
        toast.success(t("orderDetail.toast.vehicleIdentityResolved"));
      })
      .catch((error: unknown) => {
        toast.error(
          getErrorMessage(error, t("orderDetail.toast.vehicleIdentityResolveFailed")),
        );
      });
  };

  return (
    <div className="space-y-6">
      <motion.div className="w-full min-w-0 space-y-6">
        <OrderTopBar
          order={order}
          assignedTechName={assignedTechName}
          bayName={assignedBayName}
          catalogSearchSession={catalogSearchSession}
          oemConcernCode={oemConcern?.code ?? null}
          onPrint={handlePrint}
        />

        <VehicleIdentityBanner vehicleId={order.vehicle.id} />
        <TyreSetsSummary vehicleId={order.vehicle.id} readOnly as="h2" />
        <div className="min-w-0">
          <WorkshopOrderMeasurementsSection orderId={order.id} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <motion.div
            className="space-y-6 lg:col-span-1"
            initial={{ opacity: 0, x: -8 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: { duration: 0.22, ease: "easeOut" },
            }}
          >
            <CustomerVehicleInfo
              order={order}
              assignedTechName={assignedTechName}
              assignedTechId={assignedTechId}
              mechanics={activeMechanics}
              bayName={assignedBayName}
              canAssignTech={canAssignTech}
              isAssigningTech={assignBoard.isPending}
              onAssignedTechChange={(mechanicId) =>
                void handleAssignedTechChange(mechanicId)
              }
            />
            {canManageEstimates && (
              <>
                <MechanicFindingAdvisorPanel orderId={order.id} />
                <WorkshopEstimateCard
                  orderId={order.id}
                  orderStatus={order.status}
                  isLocked={!!isLocked}
                  orderRevision={JSON.stringify(order.tasks ?? [])}
                  customer={order.customer ?? null}
                />
                <ResumeWaitingTasksPanel
                  orderId={order.id}
                  waitingCount={countWaitingTasks(order.tasks)}
                  orderStatus={order.status}
                />
                <WorkshopReadyEmailNotice orderId={order.id} notice={order.ready_email_notice} />
                <WorkshopCommunicationTimeline orderId={order.id} />
              </>
            )}
          </motion.div>

          <motion.div
            className="space-y-6 lg:col-span-2"
            initial={{ opacity: 0, x: 8 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: { duration: 0.22, ease: "easeOut", delay: 0.04 },
            }}
          >
            <TaskList
              order={order}
              tasks={checkout.tasks}
              rawTaskTotals={checkout.rawTaskTotals}
              isLocked={isLocked}
              newTaskTitle={newTaskTitle}
              expandedTaskId={expandedTaskId}
              onNewTaskTitleChange={setNewTaskTitle}
              onAddTask={() => void handleAddTask()}
              onToggleTask={(taskId, checked) =>
                void handleToggleTask(taskId, checked)
              }
              onExpandedTaskIdChange={setExpandedTaskId}
              onTaskLineItemsChange={(taskId, items) =>
                void handleTaskLineItemsChange(taskId, items)
              }
              onTaskMechanicNotesChange={(taskId, notes) =>
                void handleTaskMechanicNotesChange(taskId, notes)
              }
              onTaskDelete={(taskId) => {
                const task = checkout.tasks.find(
                  (existingTask) => existingTask.id === taskId,
                );
                if (task) {
                  setTaskPendingDelete(task);
                }
              }}
              canDeleteTask={canDeleteTasks}
              isDeletingTask={deleteTask.isPending}
              onSaveReportedIssue={(value) =>
                void handleSaveReportedIssue(value)
              }
              onSaveNotes={(value) => void handleSaveNotes(value)}
              onOpenFitmentSearch={
                isLocked ? undefined : handleOpenFitmentSearch
              }
            />
          </motion.div>
        </div>

        <CheckoutFooter
          {...checkout.footerProps}
          isLocked={isLocked}
          invoiceWarning={<InvoiceOverrunWarning orderId={order.id} canIssueInvoice={checkout.canIssueInvoiceInCheckout} />}
        />
      </motion.div>

      {fitmentSearchTaskId && (
        <FitmentSearchModal
          open={fitmentSearchTaskId !== null}
          onOpenChange={(open) => {
            if (!open) setFitmentSearchTaskId(null);
          }}
          workshopOrderId={order.id}
          taskId={fitmentSearchTaskId}
          vehicleId={order.vehicle.id}
          oemConcernCode={oemConcern?.code ?? null}
          isIdentityStale={isIdentityStale}
          onSearchSessionUpdate={handleCatalogSearchSessionUpdate}
          onRequestResolveIdentity={handleRequestResolveIdentity}
        />
      )}

      <RecordPickerlDialog
        vehicleId={order.vehicle.id}
        open={recordPickerlOpen}
        initialInspectedOn={recordPickerlInspectedOn}
        onOpenChange={setRecordPickerlOpen}
      />

      <AlertDialog
        open={taskPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTaskPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("orderDetail.deleteTaskTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {taskPendingDelete
                ? t("orderDetail.deleteTaskDescription", { title: taskPendingDelete.title })
                : t("orderDetail.deleteTaskDescriptionGeneric")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTask.isPending}>
              {t("orderDetail.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteTask();
              }}
              disabled={!canDeleteTasks || deleteTask.isPending}
            >
              {deleteTask.isPending ? t("orderDetail.deleting") : t("orderDetail.deleteTask")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default WorkshopOrderDetails;
