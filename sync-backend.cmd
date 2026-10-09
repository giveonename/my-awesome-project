@echo off
@REM [LEGACY] 改后端代码推荐: docker compose up -d --build backend worker
echo ========================================
echo  Wardrobe Backend - Sync & Restart
echo ========================================

echo.
echo [1/4] Syncing code files to container...
docker cp backend\app\config.py wardrobe-backend:/app/app/config.py
docker cp backend\app\utils\signed_urls.py wardrobe-backend:/app/app/utils/signed_urls.py
docker cp backend\app\services\aliyun_vision_service.py wardrobe-backend:/app/app/services/aliyun_vision_service.py
docker cp backend\app\services\image_service.py wardrobe-backend:/app/app/services/image_service.py
docker cp backend\app\api\items.py wardrobe-backend:/app/app/api/items.py
docker cp backend\app\api\virtual_tryon.py wardrobe-backend:/app/app/api/virtual_tryon.py
docker cp backend\app\services\virtual_tryon_service.py wardrobe-backend:/app/app/services/virtual_tryon_service.py
docker cp backend\app\services\oss_service.py wardrobe-backend:/app/app/services/oss_service.py
docker cp backend\app\models\item.py wardrobe-backend:/app/app/models/item.py
docker cp backend\app\models\body_profile.py wardrobe-backend:/app/app/models/body_profile.py
docker cp backend\app\schemas\item.py wardrobe-backend:/app/app/schemas/item.py
docker cp backend\app\services\item_service.py wardrobe-backend:/app/app/services/item_service.py
docker cp backend\app\api\products.py wardrobe-backend:/app/app/api/products.py
docker cp backend\app\services\taobao_service.py wardrobe-backend:/app/app/services/taobao_service.py
docker cp backend\app\api\router.py wardrobe-backend:/app/app/api/router.py

echo [1b/4] Syncing background assets...
docker exec wardrobe-backend mkdir -p /app/app/assets/backgrounds
docker cp backend\app\assets\backgrounds\bg_white_minimal.png wardrobe-backend:/app/app/assets/backgrounds/
docker cp backend\app\assets\backgrounds\bg_luxury_grey.png wardrobe-backend:/app/app/assets/backgrounds/
docker cp backend\app\assets\backgrounds\bg_warm_wood.png wardrobe-backend:/app/app/assets/backgrounds/
docker cp backend\app\assets\backgrounds\bg_dark_drama.png wardrobe-backend:/app/app/assets/backgrounds/
docker cp backend\app\assets\backgrounds\bg_urban_outdoor.png wardrobe-backend:/app/app/assets/backgrounds/
docker cp backend\app\assets\backgrounds\bg_velvet_curtain.png wardrobe-backend:/app/app/assets/backgrounds/

echo.
echo [2/4] Installing Alibaba Cloud SDK in container...
docker exec wardrobe-backend pip install -q alibabacloud_imageseg20191230 alibabacloud_tea_openapi alibabacloud_tea_util alibabacloud_credentials

echo.
echo [3/4] Restarting container...
docker restart wardrobe-backend

echo.
echo [4/4] Waiting for health check...
timeout /t 10 /nobreak >nul
docker exec wardrobe-backend curl -s http://localhost:8000/api/v1/health

echo.
echo ========================================
echo  Done! Container synced and restarted.
echo ========================================


