// 获取DOM元素
const webcamElement = document.getElementById('webcam');
const canvasElement = document.getElementById('canvas');
const startBtn = document.getElementById('startBtn');
const clearBtn = document.getElementById('clearBtn');
const colorPicker = document.getElementById('colorPicker');
const lineWidthSlider = document.getElementById('lineWidth');
const lineWidthValue = document.getElementById('lineWidthValue');

// 创建预览画布
const previewCanvas = document.createElement('canvas');
const previewCtx = previewCanvas.getContext('2d');

// 设置画布上下文
const canvasCtx = canvasElement.getContext('2d');
let stream = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentColor = colorPicker.value;
let currentLineWidth = parseInt(lineWidthSlider.value);

// 绘图模式和高级设置
let drawMode = 'smooth'; // smooth, free, shape
let showHandIndicator = true; // 显示手部指示器
let isEraserMode = false; // 橡皮擦模式
let isDrawingEnabled = true; // 是否启用绘图

// 手势识别相关变量
let model = null;
let detectionInterval = null;
let isHandDetected = false;
let handDetectionConfidence = 0.7; // 置信度阈值
let trackingHistory = []; // 用于存储手部位置历史，实现平滑绘图
let velocity = { x: 0, y: 0 }; // 用于计算速度，实现更自然的绘图
let isModelLoading = false; // 模型加载状态
let modelLoadAttempts = 0; // 模型加载尝试次数
let maxModelLoadAttempts = 3; // 最大模型加载尝试次数

// 更新线条粗细显示
lineWidthSlider.addEventListener('input', () => {
    currentLineWidth = parseInt(lineWidthSlider.value);
    lineWidthValue.textContent = currentLineWidth;
});

// 更新颜色选择
colorPicker.addEventListener('change', () => {
    currentColor = colorPicker.value;
});

// 清空画布
clearBtn.addEventListener('click', clearCanvas);
// 清空画布
function clearCanvas() {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
}

// 初始化摄像头
async function initWebcam() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 1280 }, height: { ideal: 720 } } 
        });
        webcamElement.srcObject = stream;
        
        // 摄像头视频加载完成后设置画布尺寸
        webcamElement.onloadedmetadata = () => {
            canvasElement.width = webcamElement.videoWidth;
            canvasElement.height = webcamElement.videoHeight;
            
            // 设置预览画布尺寸
            previewCanvas.width = webcamElement.videoWidth;
            previewCanvas.height = webcamElement.videoHeight;
            
            startHandTracking();
        };
    } catch (err) {
        console.error('获取摄像头失败:', err);
        alert('无法访问摄像头，请确保已授权并检查设备连接');
    }
}

// 等待handtrack.js库加载的函数
function waitForHandTrackLibrary(timeout = 15000) {
    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
            if (typeof handtrack !== 'undefined') {
                clearInterval(checkInterval);
                resolve();
            }
        }, 100);
        
        setTimeout(() => {
            clearInterval(checkInterval);
            reject(new Error('handtrack.js库加载超时'));
        }, timeout);
    });
}

// 尝试重新加载handtrack.js库
function reloadHandTrackLibrary() {
    return new Promise((resolve, reject) => {
        // 移除现有的handtrack脚本
        const existingScript = document.querySelector('script[src*="handtrack"]');
        if (existingScript) {
            existingScript.remove();
        }
        
        // 创建新的脚本元素
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/handtrackjs@1.1.3/dist/handtrack.min.js';
        script.onload = () => {
            console.log('handtrack.js库重新加载成功');
            resolve();
        };
        script.onerror = () => {
            reject(new Error('handtrack.js库重新加载失败'));
        };
        
        document.head.appendChild(script);
    });
}

// 加载手势识别模型
async function loadHandDetectionModel() {
    // 防止重复加载
    if (isModelLoading) return false;
    
    isModelLoading = true;
    modelLoadAttempts++;
    
    console.log(`正在加载手势识别模型... (尝试 ${modelLoadAttempts}/${maxModelLoadAttempts})`);
    
    try {
        // 首先检查handtrack库是否已加载，如果没有则等待或重新加载
        if (typeof handtrack === 'undefined') {
            console.log('检测到handtrack.js库未加载，尝试等待或重新加载...');
            showStatusMessage('正在加载必要的手势识别库...', 'info');
            
            try {
                // 尝试等待一小段时间
                await waitForHandTrackLibrary(3000);
            } catch (waitError) {
                // 等待失败，尝试重新加载
                console.log('等待失败，尝试重新加载handtrack.js库...');
                await reloadHandTrackLibrary();
                // 给新加载的库一点时间初始化
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // 再次检查
            if (typeof handtrack === 'undefined') {
                throw new Error('无法加载handtrack.js库，请检查网络连接');
            }
        }
        
        // 设置模型参数
        const modelParams = {
            flipHorizontal: true,   // 水平翻转，与摄像头显示一致
            maxNumBoxes: 1,        // 最多检测一个手
            iouThreshold: 0.5,     // IoU阈值
            scoreThreshold: handDetectionConfidence  // 置信度阈值
        };
        
        // 加载模型，设置超时
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('模型加载超时')), 30000); // 30秒超时
        });
        
        showStatusMessage('正在加载手势识别模型...', 'info');
        model = await Promise.race([handtrack.load(modelParams), timeoutPromise]);
        console.log('手势识别模型加载完成');
        
        // 重置加载状态
        isModelLoading = false;
        modelLoadAttempts = 0;
        
        return true;
    } catch (error) {
        console.error('手势识别模型加载失败:', error);
        
        // 重置加载状态
        isModelLoading = false;
        
        // 检查是否已达到最大尝试次数
        if (modelLoadAttempts >= maxModelLoadAttempts) {
            showError('手势识别功能无法使用', 
                `无法加载手势识别库或模型。可能的原因：\n` +
                `1. 网络连接问题\n` +
                `2. CDN服务不可用\n` +
                `3. 浏览器安全限制\n\n` +
                `您仍可以使用鼠标或触摸屏进行绘图。`
            );
            modelLoadAttempts = 0;
        } else {
            // 自动重试
            console.log('将在3秒后自动重试...');
            showStatusMessage(`加载失败，3秒后自动重试 (${modelLoadAttempts}/${maxModelLoadAttempts})`, 'warning');
            
            setTimeout(() => {
                loadHandDetectionModel().then(success => {
                    if (success && detectionInterval === null) {
                        detectionInterval = setInterval(detectHands, 30);
                        showStatusMessage('手势识别已启动！', 'success');
                        alert('手势识别已启动！请将手放在摄像头前开始绘图。\n' +
                              '提示：\n' +
                              '- 移动手部来绘制图案\n' +
                              '- 使用控制面板调整设置\n' +
                              '- 如果识别不准确，尝试调整手与摄像头的距离');
                    }
                });
            }, 3000);
        }
        
        return false;
    }
}

// 绘制手部指示器
function drawHandIndicator(x, y, handBox) {
    if (!showHandIndicator) return;
    
    // 清除预览画布
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    
    // 绘制手部边界框
    previewCtx.strokeStyle = '#00FF00';
    previewCtx.lineWidth = 2;
    previewCtx.strokeRect(handBox[0], handBox[1], handBox[2], handBox[3]);
    
    // 绘制中心点
    previewCtx.fillStyle = '#FF0000';
    previewCtx.beginPath();
    previewCtx.arc(x, y, 8, 0, 2 * Math.PI);
    previewCtx.fill();
    
    // 绘制十字线
    previewCtx.strokeStyle = '#FF0000';
    previewCtx.lineWidth = 1;
    previewCtx.beginPath();
    previewCtx.moveTo(x - 15, y);
    previewCtx.lineTo(x + 15, y);
    previewCtx.moveTo(x, y - 15);
    previewCtx.lineTo(x, y + 15);
    previewCtx.stroke();
}

// 执行手部检测
async function detectHands() {
    if (!model || !webcamElement.srcObject) return;
    
    try {
        // 检测手部
        const predictions = await model.detect(webcamElement);
        
        // 清除预览画布
        if (!isHandDetected) {
            previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        }
        
        // 清除之前的跟踪历史（保留最近10个点用于平滑）
        if (trackingHistory.length > 10) {
            trackingHistory.shift();
        }
        
        // 处理检测结果
        if (predictions.length > 0) {
            const hand = predictions[0];
            const centerX = hand.bbox[0] + hand.bbox[2] / 2;
            const centerY = hand.bbox[1] + hand.bbox[3] / 2;
            
            // 绘制手部指示器
            drawHandIndicator(centerX, centerY, hand.bbox);
            
            // 计算速度
            if (trackingHistory.length > 0) {
                const lastPos = trackingHistory[trackingHistory.length - 1];
                velocity.x = (centerX - lastPos.x) * 0.5; // 平滑系数
                velocity.y = (centerY - lastPos.y) * 0.5;
            }
            
            // 记录手部位置
            trackingHistory.push({ x: centerX, y: centerY });
            
            // 计算平滑后的位置
            let targetX, targetY;
            
            if (drawMode === 'smooth') {
                // 平滑模式：使用加权平均
                const weights = trackingHistory.map((_, i) => (i + 1) / trackingHistory.length);
                const weightSum = weights.reduce((sum, w) => sum + w, 0);
                
                targetX = trackingHistory.reduce((sum, pos, i) => sum + pos.x * weights[i], 0) / weightSum;
                targetY = trackingHistory.reduce((sum, pos, i) => sum + pos.y * weights[i], 0) / weightSum;
            } else {
                // 自由模式：直接使用当前位置
                targetX = centerX;
                targetY = centerY;
            }
            
            // 处理绘图逻辑
            if (isHandDetected && isDrawingEnabled) {
                // 已经检测到手，继续绘制
                handDraw(targetX, targetY);
            } else {
                // 刚开始检测到手，初始化位置
                isHandDetected = true;
                lastX = targetX;
                lastY = targetY;
            }
        } else {
            // 没有检测到手，停止绘制
            isHandDetected = false;
            trackingHistory = [];
            previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        }
    } catch (error) {
        console.error('手部检测失败:', error);
    }
}

// 添加高级控制面板
function addAdvancedControls() {
    const controlsDiv = document.querySelector('.controls');
    
    // 添加绘图模式选择
    const modeDiv = document.createElement('div');
    modeDiv.className = 'control-group';
    modeDiv.innerHTML = `
        <label>绘图模式:</label>
        <select id="drawModeSelect">
            <option value="smooth">平滑绘图</option>
            <option value="free">自由绘图</option>
        </select>
    `;
    controlsDiv.appendChild(modeDiv);
    
    // 添加橡皮擦切换
    const eraserBtn = document.createElement('button');
    eraserBtn.id = 'eraserBtn';
    eraserBtn.textContent = '橡皮擦';
    eraserBtn.addEventListener('click', () => {
        isEraserMode = !isEraserMode;
        eraserBtn.textContent = isEraserMode ? '绘图模式' : '橡皮擦';
        eraserBtn.style.backgroundColor = isEraserMode ? '#95a5a6' : '#3498db';
    });
    controlsDiv.appendChild(eraserBtn);
    
    // 添加手部指示器切换
    const indicatorBtn = document.createElement('button');
    indicatorBtn.id = 'indicatorBtn';
    indicatorBtn.textContent = '显示手部指示器';
    indicatorBtn.addEventListener('click', () => {
        showHandIndicator = !showHandIndicator;
        indicatorBtn.textContent = showHandIndicator ? '隐藏手部指示器' : '显示手部指示器';
    });
    controlsDiv.appendChild(indicatorBtn);
    
    // 添加绘图开关
    const drawToggleBtn = document.createElement('button');
    drawToggleBtn.id = 'drawToggleBtn';
    drawToggleBtn.textContent = '暂停绘图';
    drawToggleBtn.addEventListener('click', () => {
        isDrawingEnabled = !isDrawingEnabled;
        drawToggleBtn.textContent = isDrawingEnabled ? '暂停绘图' : '继续绘图';
        drawToggleBtn.style.backgroundColor = isDrawingEnabled ? '#3498db' : '#f39c12';
    });
    controlsDiv.appendChild(drawToggleBtn);
    
    // 添加重试加载模型按钮
    const reloadModelBtn = document.createElement('button');
    reloadModelBtn.id = 'reloadModelBtn';
    reloadModelBtn.textContent = '重试加载模型';
    reloadModelBtn.style.backgroundColor = '#e74c3c';
    reloadModelBtn.addEventListener('click', () => {
        if (!isModelLoading) {
            console.log('用户手动触发模型重新加载');
            reloadModelBtn.textContent = '加载中...';
            reloadModelBtn.disabled = true;
            
            // 清理现有模型
            if (model) {
                model.dispose();
                model = null;
            }
            
            loadHandDetectionModel().then(success => {
                reloadModelBtn.textContent = '重试加载模型';
                reloadModelBtn.disabled = false;
                
                if (success && detectionInterval === null) {
                    detectionInterval = setInterval(detectHands, 30);
                    alert('手势识别已启动！请将手放在摄像头前开始绘图。\n' +
                          '提示：\n' +
                          '- 移动手部来绘制图案\n' +
                          '- 使用控制面板调整设置\n' +
                          '- 如果识别不准确，尝试调整手与摄像头的距离');
                }
            });
        }
    });
    controlsDiv.appendChild(reloadModelBtn);
    
    // 绘图模式选择事件
    document.getElementById('drawModeSelect').addEventListener('change', (e) => {
        drawMode = e.target.value;
    });
}

// 显示错误提示函数
function showError(title, message) {
    // 检查是否已存在错误提示元素
    let errorDiv = document.getElementById('errorNotification');
    
    if (!errorDiv) {
        // 创建错误提示元素
        errorDiv = document.createElement('div');
        errorDiv.id = 'errorNotification';
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: #f8d7da;
            color: #721c24;
            padding: 15px;
            border: 1px solid #f5c6cb;
            border-radius: 5px;
            z-index: 1000;
            max-width: 400px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;
        document.body.appendChild(errorDiv);
    }
    
    // 设置错误内容
    errorDiv.innerHTML = `
        <h3 style="margin-top: 0; color: #721c24;">${title}</h3>
        <p>${message}</p>
        <button id="dismissErrorBtn" style="
            background-color: #dc3545;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 3px;
            cursor: pointer;
            margin-right: 10px;
        ">关闭</button>
        <button id="retryErrorBtn" style="
            background-color: #28a745;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 3px;
            cursor: pointer;
        ">重试加载</button>
    `;
    
    // 添加关闭按钮事件
    document.getElementById('dismissErrorBtn').addEventListener('click', () => {
        errorDiv.style.display = 'none';
    });
    
    // 添加重试按钮事件
    document.getElementById('retryErrorBtn').addEventListener('click', () => {
        errorDiv.style.display = 'none';
        const reloadBtn = document.getElementById('reloadModelBtn');
        if (reloadBtn) {
            reloadBtn.click();
        }
    });
    
    // 显示错误提示
    errorDiv.style.display = 'block';
}

// 初始化预览画布
function initPreviewCanvas() {
    // 设置预览画布样式和位置
    previewCanvas.style.position = 'absolute';
    previewCanvas.style.top = '0';
    previewCanvas.style.left = '0';
    previewCanvas.style.pointerEvents = 'none';
    previewCanvas.style.zIndex = '1';
    
    // 将预览画布添加到游戏区域
    const gameArea = document.querySelector('.game-area');
    gameArea.appendChild(previewCanvas);
}

// 开始手势跟踪和绘图
function startHandTracking() {
    console.log('开始手势跟踪');
    
    // 初始化预览画布
    initPreviewCanvas();
    
    // 添加高级控制面板
    addAdvancedControls();
    
    // 先保留鼠标和触摸事件作为备用
    canvasElement.addEventListener('mousedown', startDrawing);
    canvasElement.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stopDrawing);
    
    // 移动设备触摸支持
    canvasElement.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        startDrawing({ clientX: touch.clientX, clientY: touch.clientY });
    });
    
    canvasElement.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        draw({ clientX: touch.clientX, clientY: touch.clientY });
    });
    
    window.addEventListener('touchend', stopDrawing);
    
    // 显示加载状态提示
    showStatusMessage('正在加载手势识别模型...', 'info');
    
    // 加载并启动手势识别
    loadHandDetectionModel().then(success => {
        if (success) {
            // 每30毫秒检测一次
            detectionInterval = setInterval(detectHands, 30);
            showStatusMessage('手势识别已启动！', 'success');
            alert('手势识别已启动！请将手放在摄像头前开始绘图。\n' +
                  '提示：\n' +
                  '- 移动手部来绘制图案\n' +
                  '- 使用控制面板调整设置\n' +
                  '- 如果识别不准确，尝试调整手与摄像头的距离');
        } else {
            // 加载失败，但已有自动重试机制和错误提示
            console.log('模型加载失败，正在处理重试或等待用户操作');
        }
    });
}

// 显示状态消息
function showStatusMessage(message, type = 'info') {
    // 检查是否已存在状态消息元素
    let statusDiv = document.getElementById('statusMessage');
    
    if (!statusDiv) {
        // 创建状态消息元素
        statusDiv = document.createElement('div');
        statusDiv.id = 'statusMessage';
        statusDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 20px;
            border-radius: 5px;
            z-index: 1000;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(statusDiv);
    }
    
    // 设置消息样式和内容
    switch (type) {
        case 'success':
            statusDiv.style.backgroundColor = '#d4edda';
            statusDiv.style.color = '#155724';
            break;
        case 'error':
            statusDiv.style.backgroundColor = '#f8d7da';
            statusDiv.style.color = '#721c24';
            break;
        case 'warning':
            statusDiv.style.backgroundColor = '#fff3cd';
            statusDiv.style.color = '#856404';
            break;
        case 'info':
        default:
            statusDiv.style.backgroundColor = '#d1ecf1';
            statusDiv.style.color = '#0c5460';
    }
    
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
    statusDiv.style.opacity = '1';
    
    // 非错误类型的消息3秒后自动消失
    if (type !== 'error') {
        setTimeout(() => {
            statusDiv.style.opacity = '0';
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 300);
        }, 3000);
    }
}

// 手部绘图函数
function handDraw(x, y) {
    // 设置绘图样式
    canvasCtx.strokeStyle = isEraserMode ? '#ffffff' : currentColor;
    canvasCtx.lineWidth = isEraserMode ? currentLineWidth * 2 : currentLineWidth;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    
    // 计算移动距离，如果移动太小则不绘制（防抖）
    const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
    
    if (distance > 2) { // 只有移动超过2像素才绘制
        // 高级绘图：根据速度调整线条粗细，实现更自然的效果
        if (drawMode === 'smooth') {
            const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
            const dynamicLineWidth = Math.max(1, Math.min(currentLineWidth * 1.5, currentLineWidth + speed * 0.1));
            canvasCtx.lineWidth = isEraserMode ? dynamicLineWidth * 2 : dynamicLineWidth;
            
            // 使用贝塞尔曲线实现平滑绘图
            const cpx = (lastX + x) / 2;
            const cpy = (lastY + y) / 2;
            
            canvasCtx.beginPath();
            canvasCtx.moveTo(lastX, lastY);
            canvasCtx.quadraticCurveTo(cpx, cpy, x, y);
            canvasCtx.stroke();
        } else {
            // 自由模式：直接绘制直线
            canvasCtx.beginPath();
            canvasCtx.moveTo(lastX, lastY);
            canvasCtx.lineTo(x, y);
            canvasCtx.stroke();
        }
        
        // 更新上一个坐标
        lastX = x;
        lastY = y;
    }
}

// 开始绘图
function startDrawing(e) {
    isDrawing = true;
    const rect = canvasElement.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
}

// 绘图函数
function draw(e) {
    if (!isDrawing) return;
    
    const rect = canvasElement.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    
    // 设置绘图样式
    canvasCtx.strokeStyle = currentColor;
    canvasCtx.lineWidth = currentLineWidth;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    
    // 开始绘制
    canvasCtx.beginPath();
    canvasCtx.moveTo(lastX, lastY);
    canvasCtx.lineTo(currentX, currentY);
    canvasCtx.stroke();
    
    // 更新上一个坐标
    lastX = currentX;
    lastY = currentY;
}

// 停止绘图
function stopDrawing() {
    isDrawing = false;
}

// 开始游戏按钮点击事件
startBtn.addEventListener('click', () => {
    if (stream) {
        // 如果已经有流，重新开始
        stream.getTracks().forEach(track => track.stop());
    }
    initWebcam();
    startBtn.textContent = '重新开始';
});

// 页面加载完成后的初始化
window.addEventListener('load', () => {
    lineWidthValue.textContent = currentLineWidth;
});

// 清理资源
function cleanup() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    
    if (detectionInterval) {
        clearInterval(detectionInterval);
    }
    
    if (model) {
        model.dispose();
    }
}

window.addEventListener('beforeunload', cleanup);

// 开始游戏按钮更新
startBtn.addEventListener('click', () => {
    // 清理之前的资源
    cleanup();
    
    // 重新初始化
    initWebcam();
    startBtn.textContent = '重新开始';
});