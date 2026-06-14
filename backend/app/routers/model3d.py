from fastapi import APIRouter, HTTPException

from app.schemas.model3d import Model3DCreateRequest, Model3DTaskResponse
from app.services.doubao_3d import Doubao3DService

router = APIRouter(prefix="/api/v1/model3d", tags=["model3d"])


@router.post("/generate", response_model=Model3DTaskResponse)
async def generate_model3d(request: Model3DCreateRequest) -> Model3DTaskResponse:
    try:
        service = Doubao3DService()
        return await service.generate_and_wait(request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"3D 模型生成失败: {e}") from e


@router.get("/tasks/{task_id}", response_model=Model3DTaskResponse)
async def get_model3d_task(task_id: str) -> Model3DTaskResponse:
    try:
        service = Doubao3DService()
        return await service.get_task(task_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询 3D 任务失败: {e}") from e


@router.delete("/tasks/{task_id}")
async def delete_model3d_task(task_id: str):
    try:
        service = Doubao3DService()
        return await service.delete_task(task_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除 3D 任务失败: {e}") from e
