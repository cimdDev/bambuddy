"""OrderBatch (print batch) API routes - planning layer on top of the existing queue."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.auth import RequirePermissionIfAuthEnabled
from backend.app.core.database import get_db
from backend.app.core.permissions import Permission
from backend.app.models.user import User
from backend.app.schemas.print_batch import (
    PrintBatchConfigDispatchRequest,
    PrintBatchDispatchRequest,
    PrintBatchDispatchResponse,
    PrintBatchOrderCreate,
    PrintBatchOrderDetailResponse,
    PrintBatchOrderListItem,
    PrintBatchOrderUpdate,
    PrintBatchPlateConfigCreate,
    PrintBatchPlateConfigResponse,
    PrintBatchPlateConfigSlotsReplace,
    PrintBatchPlateConfigUpdate,
)
from backend.app.services.print_batch_service import BatchServiceError, PrintBatchService

router = APIRouter(prefix="/orders", tags=["orders"])


def _service(db: AsyncSession) -> PrintBatchService:
    return PrintBatchService(db)


def _http_error(exc: BatchServiceError) -> HTTPException:
    message = str(exc)
    message_l = message.lower()
    if "not found" in message_l:
        return HTTPException(status_code=404, detail=message)
    if "already exists" in message_l or "duplicate" in message_l or "conflict" in message_l:
        return HTTPException(status_code=409, detail=message)
    return HTTPException(status_code=400, detail=message)


@router.get("", response_model=list[PrintBatchOrderListItem])
@router.get("/", response_model=list[PrintBatchOrderListItem])
async def list_orders(
    db: AsyncSession = Depends(get_db),
    _: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_READ),
):
    return await _service(db).list_orders()


@router.post("", response_model=PrintBatchOrderDetailResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=PrintBatchOrderDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_order(
    data: PrintBatchOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_CREATE),
):
    try:
        return await _service(db).create_order(data, current_user=current_user)
    except BatchServiceError as exc:
        raise _http_error(exc) from exc


@router.get("/{order_id}", response_model=PrintBatchOrderDetailResponse)
async def get_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_READ),
):
    try:
        return await _service(db).get_order_detail(order_id)
    except BatchServiceError as exc:
        raise _http_error(exc) from exc


@router.put("/{order_id}", response_model=PrintBatchOrderDetailResponse)
async def update_order(
    order_id: int,
    data: PrintBatchOrderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_CREATE),
):
    try:
        return await _service(db).update_order(order_id, data, current_user=current_user)
    except BatchServiceError as exc:
        raise _http_error(exc) from exc


@router.delete("/{order_id}")
async def delete_order(
    order_id: int,
    db: AsyncSession = Depends(get_db),
    _: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_CREATE),
):
    try:
        await _service(db).delete_order(order_id)
        return {"message": "Order deleted"}
    except BatchServiceError as exc:
        raise _http_error(exc) from exc


@router.post("/{order_id}/configs", response_model=PrintBatchPlateConfigResponse, status_code=status.HTTP_201_CREATED)
async def create_order_config(
    order_id: int,
    data: PrintBatchPlateConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_CREATE),
):
    try:
        return await _service(db).create_or_update_config(order_id, data, current_user=current_user)
    except BatchServiceError as exc:
        raise _http_error(exc) from exc


@router.put("/configs/{config_id}", response_model=PrintBatchPlateConfigResponse)
async def update_config(
    config_id: int,
    data: PrintBatchPlateConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_CREATE),
):
    try:
        return await _service(db).update_config(config_id, data, current_user=current_user)
    except BatchServiceError as exc:
        raise _http_error(exc) from exc


@router.put("/configs/{config_id}/slots", response_model=PrintBatchPlateConfigResponse)
async def replace_config_slots(
    config_id: int,
    data: PrintBatchPlateConfigSlotsReplace,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_CREATE),
):
    try:
        return await _service(db).replace_config_slots(config_id, data.slots, current_user=current_user)
    except BatchServiceError as exc:
        raise _http_error(exc) from exc


@router.post("/configs/{config_id}/dispatch", response_model=PrintBatchDispatchResponse)
async def dispatch_config_remaining(
    config_id: int,
    data: PrintBatchConfigDispatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_CREATE),
):
    try:
        return await _service(db).dispatch_remaining(config_id, limit=data.limit, current_user=current_user)
    except BatchServiceError as exc:
        raise _http_error(exc) from exc


@router.post("/{order_id}/dispatch", response_model=PrintBatchDispatchResponse)
async def dispatch_order_remaining(
    order_id: int,
    data: PrintBatchDispatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_CREATE),
):
    try:
        return await _service(db).dispatch_order_remaining(order_id, limit=data.limit, current_user=current_user)
    except BatchServiceError as exc:
        raise _http_error(exc) from exc


@router.post("/{order_id}/plates/{plate_index}/dispatch", response_model=PrintBatchDispatchResponse)
async def dispatch_plate_remaining(
    order_id: int,
    plate_index: int,
    data: PrintBatchDispatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = RequirePermissionIfAuthEnabled(Permission.QUEUE_CREATE),
):
    try:
        return await _service(db).dispatch_plate_remaining(
            order_id, plate_index, limit=data.limit, current_user=current_user
        )
    except BatchServiceError as exc:
        raise _http_error(exc) from exc
