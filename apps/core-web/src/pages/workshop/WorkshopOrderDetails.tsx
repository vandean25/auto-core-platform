import { useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { FitmentSearchModal } from "@/components/workshop/FitmentSearchModal";
import { VehicleIdentityBanner } from "@/components/workshop/VehicleIdentityBanner";
import { InvoiceOverrunWarning } from "@/components/workshop/InvoiceOverrunWarning";
import { TyreSetsSummary } from "@/features/tyre-storage/TyreSetsSummary";
import { WorkshopOrderMeasurementsSection } from "@/components/workshop/WorkshopOrderMeasurementsSection";
import { useWorkshopOrder } from "@/api/workshop";
import type { WorkshopOrder } from "@/api/types";
import {
  canCheckInWorkshopOrder,
  canGenerateWorkshopJobCardPdf,
  isWorkshopCheckInOpenStatus,
  isWorkshopOrderLockedStatus,
} from "@/features/actions/action-role-predicates";
import { useAuthRole } from "@/features/actions/use-auth-role";
import { OrderTopBar, CustomerVehicleInfo } from "./components/OrderHeader";
import { OrderAdvisorPanels } from "./components/OrderAdvisorPanels";
import { OrderLoading, OrderNotFound } from "./components/OrderLoadStates";
import { TaskList } from "./components/TaskList";
import { CheckoutFooter } from "./components/CheckoutFooter";
import { DeleteTaskDialog } from "./components/DeleteTaskDialog";
import { useWorkshopCheckout } from "./hooks/useWorkshopCheckout";
import { useWorkshopFitmentSearch } from "./hooks/useWorkshopFitmentSearch";
import { useWorkshopOrderActions } from "./hooks/useWorkshopOrderActions";
import { useWorkshopPickerlPrompt } from "./hooks/useWorkshopPickerlPrompt";
import { useWorkshopTaskActions } from "./hooks/useWorkshopTaskActions";
import { useWorkshopTaskLineItems } from "./hooks/useWorkshopTaskLineItems";
import { useWorkshopTechAssignment } from "./hooks/useWorkshopTechAssignment";
import { APP_ROUTE_PATHS } from "@/lib/app-route-paths";
import { RecordPickerlDialog } from "@/components/vehicles/RecordPickerlDialog";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export function WorkshopOrderDetails() {
  const { id = "" } = useParams<{ id: string }>();
  const { data: order, isLoading } = useWorkshopOrder(id);
  useDocumentTitle(order?.order_number);

  if (isLoading) return <OrderLoading />;
  if (!order) return <OrderNotFound />;
  return <WorkshopOrderView order={order} />;
}

function WorkshopOrderView({ order }: { order: WorkshopOrder }) {
  const role = useAuthRole();
  const isLocked = isWorkshopOrderLockedStatus(order.status);
  const checkInHref =
    canCheckInWorkshopOrder(role) && isWorkshopCheckInOpenStatus(order.status)
      ? APP_ROUTE_PATHS.workshopOrderCheckIn.replace(":id", order.id)
      : null;
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const {
    taskLineItemOverrides,
    handleTaskLineItemsChange,
    clearTaskLineItemOverrides,
  } = useWorkshopTaskLineItems({
    orderId: order.id,
    isLocked,
    getTasks: () => checkout.tasks,
  });
  const checkout = useWorkshopCheckout({
    order,
    taskLineItemOverrides,
    onReopenTask: setExpandedTaskId,
  });
  const pickerl = useWorkshopPickerlPrompt(order, checkout.tasks);
  const orderActions = useWorkshopOrderActions(order, isLocked);
  const tech = useWorkshopTechAssignment(order);
  const fitment = useWorkshopFitmentSearch(order);
  const taskActions = useWorkshopTaskActions({
    order,
    isLocked,
    tasks: checkout.tasks,
    hasLinkedInvoice: checkout.hasLinkedInvoice,
    expandedTaskId,
    onExpandedTaskIdChange: setExpandedTaskId,
    clearTaskLineItemOverrides,
    pickerl,
  });

  return (
    <div className="space-y-6">
      <motion.div className="w-full min-w-0 space-y-6">
        <OrderTopBar
          order={order}
          assignedTechName={tech.assignedTechName}
          bayName={tech.assignedBayName}
          catalogSearchSession={fitment.catalogSearchSession}
          oemConcernCode={fitment.oemConcernCode}
          onPrint={canGenerateWorkshopJobCardPdf(role) ? orderActions.print : () => undefined}
          checkInHref={checkInHref}
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
              assignedTechName={tech.assignedTechName}
              assignedTechId={tech.assignedTechId}
              mechanics={tech.activeMechanics}
              bayName={tech.assignedBayName}
              canAssignTech={tech.canAssignTech}
              isAssigningTech={tech.isAssigningTech}
              onAssignedTechChange={(mechanicId) =>
                void tech.handleAssignedTechChange(mechanicId)
              }
            />
            <OrderAdvisorPanels order={order} isLocked={isLocked} />
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
              newTaskTitle={taskActions.newTaskTitle}
              expandedTaskId={expandedTaskId}
              onNewTaskTitleChange={taskActions.setNewTaskTitle}
              onAddTask={() => void taskActions.addTask()}
              onToggleTask={(taskId, checked) =>
                void taskActions.toggleTask(taskId, checked)
              }
              onExpandedTaskIdChange={setExpandedTaskId}
              onTaskLineItemsChange={(taskId, items) =>
                void handleTaskLineItemsChange(taskId, items)
              }
              onTaskMechanicNotesChange={(taskId, notes) =>
                void taskActions.changeMechanicNotes(taskId, notes)
              }
              onTaskDelete={taskActions.requestDeleteTask}
              canDeleteTask={taskActions.canDeleteTasks}
              isDeletingTask={taskActions.isDeletingTask}
              onSaveReportedIssue={(value) =>
                void orderActions.saveReportedIssue(value)
              }
              onSaveNotes={(value) => void orderActions.saveNotes(value)}
              onOpenFitmentSearch={
                isLocked ? undefined : fitment.openFitmentSearch
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

      {fitment.modalProps && <FitmentSearchModal {...fitment.modalProps} />}

      <RecordPickerlDialog vehicleId={order.vehicle.id} {...pickerl.dialogProps} />

      <DeleteTaskDialog
        task={taskActions.taskPendingDelete}
        canDelete={taskActions.canDeleteTasks}
        isDeleting={taskActions.isDeletingTask}
        onClose={taskActions.cancelDeleteTask}
        onConfirm={() => void taskActions.confirmDeleteTask()}
      />
    </div>
  );
}

export default WorkshopOrderDetails;
