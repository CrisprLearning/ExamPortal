angular.module('attemptExamApp', ['ngCookies'])

.config(['$qProvider', function ($qProvider) {
    $qProvider.errorOnUnhandledRejections(false);
}])


.controller('attemptExamController', function($scope, $http, $interval, $cookies, $timeout) {

    const ANSWER_MODES = Object.freeze({
        NOT_VISITED: 0,
        NOT_ANSWERED: 1,
        FOR_REVIEW: 2,
        ANSWERED_FOR_REVIEW: 3,
        ANSWERED: 4
    });

    function getUserToken() {
        const urlParams = new URLSearchParams(window.location.search);
        // start-quiz redirects with "user"; "token" kept for links built elsewhere
        return decodeURIComponent(urlParams.get('user') || urlParams.get('token'));
    }

    function getExamTokenFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        return decodeURIComponent(urlParams.get('quiz'));
    }



    // ---- Tab switch / minimise (focus loss) violations ----
    // Count persists across reloads, scoped to the current exam token.
    const VIOLATION_STORAGE_KEY = "tabSwitchViolations";
    const MAX_VIOLATION_WARNINGS = 5;
    const AUTO_SUBMIT_COUNTDOWN_SECONDS = 5;

    let isBootboxVisible = false; // Flag to track modal visibility
    let isAutoSubmitting = false;

    function getViolationCount() {
        try {
            const stored = JSON.parse(localStorage.getItem(VIOLATION_STORAGE_KEY));
            return (stored && stored.quiz === getExamTokenFromURL()) ? (parseInt(stored.count) || 0) : 0;
        } catch (e) {
            return 0;
        }
    }

    function recordViolation() {
        const count = getViolationCount() + 1;
        localStorage.setItem(VIOLATION_STORAGE_KEY, JSON.stringify({ quiz: getExamTokenFromURL(), count: count }));
        return count;
    }

    function showViolationWarning(count) {
        isBootboxVisible = true; // Set flag to prevent multiple modals
        bootbox.confirm({
            title: "<p style='color: #ff9800; font-size: 24px; margin: 0; font-weight: bold;'>Warning " + count + " of " + MAX_VIOLATION_WARNINGS + "</p>",
            message: "<p style='color: #444; font-size: 18px; font-weight: 300; line-height: 28px;'>Switching tabs or minimising the window is not allowed during the exam. The timer keeps running while you are away.<br><br><b>After " + MAX_VIOLATION_WARNINGS + " warnings, your exam will be auto-submitted.</b></p>",
            buttons: {
                cancel: {
                    label: "Get back to Test",
                    className: "btn-default"
                },
                confirm: {
                    label: "End the Exam",
                    className: "btn-danger"
                }
            },
            callback: function (result) {
                isBootboxVisible = false; // Reset flag after modal closes
                if(result) {
                    $scope.saveExamProgress('TERMINATE');
                } else {
                    // Continue exam
                    location.reload();
                }
            }
        });
    }

    // Freezes the screen with a countdown, then submits the exam.
    function startViolationAutoSubmit() {
        isAutoSubmitting = true;
        bootbox.hideAll();

        let secondsLeft = AUTO_SUBMIT_COUNTDOWN_SECONDS;
        const messageFor = function (seconds) {
            return "<p style='color: #444; font-size: 18px; font-weight: 300; line-height: 28px; margin: 0;'>You have made several violations. Auto-submitting the exam in <b id='violationCountdown'>" + seconds + "</b> seconds.</p>";
        };

        bootbox.dialog({
            title: "<p style='color: red; font-size: 24px; margin: 0; font-weight: bold;'><i class='fa fa-exclamation-triangle'></i> Exam Violation</p>",
            message: messageFor(secondsLeft),
            closeButton: false,
            onEscape: false,
            backdrop: 'static'
        });

        const countdownTimer = setInterval(function () {
            secondsLeft--;
            const counter = document.getElementById('violationCountdown');
            if (secondsLeft > 0) {
                if (counter) counter.textContent = secondsLeft;
            } else {
                clearInterval(countdownTimer);
                if (counter) counter.parentNode.innerHTML = "Submitting your exam...";
                $scope.saveExamProgress('TERMINATE');
            }
        }, 1000);
    }

    // ---- Keep the screen on during the exam ----
    // Browsers report "screen turned off" the same way as a tab switch, so a
    // screen timeout on mobile would count as a violation. A screen wake lock
    // stops the device from dimming/locking while the exam page is visible.
    // The browser releases the lock whenever the page is hidden, so it is
    // re-acquired each time the page becomes visible again.
    let screenWakeLock = null;

    async function requestScreenWakeLock() {
        if (!('wakeLock' in navigator) || document.hidden || screenWakeLock) return;
        try {
            screenWakeLock = await navigator.wakeLock.request('screen');
            screenWakeLock.addEventListener('release', function() {
                screenWakeLock = null;
            });
        } catch (e) {
            // Denied (e.g. battery saver) or not allowed yet; retried on next interaction/visibility
            screenWakeLock = null;
        }
    }

    requestScreenWakeLock();
    // Some browsers only grant the lock after a user interaction
    document.addEventListener('click', requestScreenWakeLock);
    document.addEventListener('touchend', requestScreenWakeLock);
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) requestScreenWakeLock();
    });

    document.addEventListener("visibilitychange", function() {
        if (!document.hidden || isAutoSubmitting) return;

        const count = recordViolation();
        if (count > MAX_VIOLATION_WARNINGS) {
            startViolationAutoSubmit();
        } else if (!isBootboxVisible) {
            showViolationWarning(count);
        }
    });



    //Defaults
    $scope.examDetails = {};
    $scope.examMetadata = {};
    $scope.sectionDetails = [];
    $scope.currentSection = {};
    $scope.questionsInSection = [];
    $scope.displayingQuestion = {};
    $scope.questionImageLoading = false;
    $scope.questionImageError = false;

    //Preferences
    $scope.criprInsightsEnabled = false;
    $scope.currentQuestionTimePercentageLapsed = 0;
    $scope.currentQuestionAnswered = false;
    $scope.minimumDistractions = false;


    $scope.toggleMinimumDistractions = function() {
        $scope.minimumDistractions = !$scope.minimumDistractions;
    }

    $scope.updateSectionNamesList = function(examData) {
        $scope.sectionDetails = Object.values(examData).map(section => section.name);
    }


    $scope.isActiveSection = function(sectionId) {
        return localStorage.getItem("currentSectionOpen") == sectionId;
    }

    function formatTimer(time) {
        let minutes = Math.floor(time / 60);
        let seconds = time % 60;

        minutes = String(minutes).padStart(2, '0');
        seconds = String(seconds).padStart(2, '0');
        
        return `${minutes}:${seconds}`;
    }


    $scope.trackIndividualQuestionTime = function() {
        $scope.currentQuestionKey = $scope.displayingQuestion.questionDisplayKey;
        var currentStampData = localStorage.getItem("questionTimeTracker") ? JSON.parse(localStorage.getItem("questionTimeTracker")) : {};
        if(currentStampData[$scope.currentQuestionKey]) {
            currentStampData[$scope.currentQuestionKey]++;
        } else {
            currentStampData[$scope.currentQuestionKey] = 1;
        }
        localStorage.setItem("questionTimeTracker", JSON.stringify(currentStampData));
        document.getElementById("currentQuestionTimer").innerHTML = '<i class="ti ti-timer" style="margin-right: 6px"></i>'+formatTimer(currentStampData[$scope.currentQuestionKey]);
    }


    //Open first section by default
    if(!localStorage.getItem("currentSectionOpen"))
        localStorage.setItem("currentSectionOpen", 1);


    /***********************************************************************
     * QUESTION IMAGE CACHE
     *
     * Once the quiz payload arrives, every question image is pre-fetched so
     * navigating between questions no longer depends on the network.
     *
     *  1. fetch() the image -> Blob -> object URL (served instantly, and
     *     persisted to IndexedDB so a page reload does not re-download).
     *  2. If fetch is blocked (e.g. the image host does not send CORS
     *     headers) fall back to warming the image with new Image(), which
     *     keeps it in the browser's memory/HTTP cache.
     *  3. Anything that could not be cached simply loads on demand as before.
     ***********************************************************************/
    const CACHE_CONCURRENCY = 4;
    const CACHE_MAX_ATTEMPTS = 3;
    const IDB_NAME = 'crisprExamQuestionCache';
    const IDB_STORE = 'images';
    const IDB_TOKEN_KEY = '__examToken';
    const IDB_EXPIRY_KEY = '__cacheExpiresAt';
    const CACHE_GRACE_SECONDS = 60 * 60;          // keep images one extra hour past the exam end
    const CACHE_FALLBACK_TTL_SECONDS = 24 * 60 * 60; // when the end time is unknown

    const cachedUrlByKey = new Map();   // questionDisplayKey -> blob: object URL
    const warmImageByKey = new Map();   // questionDisplayKey -> Image (fallback, keeps browser cache warm)
    const cacheInFlight = new Map();    // questionDisplayKey -> Promise<boolean>
    let preloadRunId = 0;

    $scope.questionCacheStatus = { total: 0, loaded: 0, failed: 0, done: false };

    function isQuestionCached(key) {
        return cachedUrlByKey.has(key) || warmImageByKey.has(key);
    }

    function getQuestionDisplayUrl(question) {
        if (!question) return '';
        return cachedUrlByKey.get(question.questionDisplayKey) || question.url;
    }

    function dropCachedUrl(key) {
        const objectUrl = cachedUrlByKey.get(key);
        if (objectUrl) {
            cachedUrlByKey.delete(key);
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        }
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ---- IndexedDB persistence (best effort; every call is guarded) ----
    function idbRawRequest(db, mode, action) {
        return new Promise(resolve => {
            if (!db) return resolve(undefined);
            try {
                const tx = db.transaction(IDB_STORE, mode);
                const request = action(tx.objectStore(IDB_STORE));
                request.onsuccess = function() { resolve(request.result); };
                request.onerror = function() { resolve(undefined); };
                tx.onabort = function() { resolve(undefined); };
            } catch (e) {
                resolve(undefined);
            }
        });
    }

    // Cached images must stay available at least until the exam ends. The end time
    // comes from the quiz API response; the server/device clock difference is used
    // so a wrong device clock can never expire the cache early.
    function getCacheExpiryTimestamp() {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const metadata = $scope.examMetadata || {};
        const endTime = parseInt(metadata.endTime);
        const serverNow = parseInt(metadata.currentTime);
        if (!isNaN(endTime) && !isNaN(serverNow) && endTime > serverNow) {
            return nowSeconds + (endTime - serverNow) + CACHE_GRACE_SECONDS;
        }
        return nowSeconds + CACHE_FALLBACK_TTL_SECONDS;
    }

    // Blobs are only valid for the exam they were downloaded for: wipe the store
    // when it belongs to another exam or its exam has already ended. Runs as part
    // of opening the DB so no read can ever see another exam's images.
    async function scopeImageDbToExam(db, examToken) {
        if (!db) return null;
        const storedToken = await idbRawRequest(db, 'readonly', store => store.get(IDB_TOKEN_KEY));
        const storedExpiry = parseInt(await idbRawRequest(db, 'readonly', store => store.get(IDB_EXPIRY_KEY)));
        const expired = isNaN(storedExpiry) || storedExpiry <= Math.floor(Date.now() / 1000);

        if (storedToken !== examToken || expired) {
            await idbRawRequest(db, 'readwrite', store => store.clear());
            await idbRawRequest(db, 'readwrite', store => store.put(examToken, IDB_TOKEN_KEY));
        }
        // Always refresh the expiry from the latest API response (covers extended exams)
        await idbRawRequest(db, 'readwrite', store => store.put(getCacheExpiryTimestamp(), IDB_EXPIRY_KEY));
        return db;
    }

    let imageDbPromise = null;
    function openImageDb() {
        if (imageDbPromise) return imageDbPromise;
        imageDbPromise = new Promise(resolve => {
            try {
                if (!window.indexedDB) return resolve(null);
                const request = indexedDB.open(IDB_NAME, 1);
                request.onupgradeneeded = function() {
                    request.result.createObjectStore(IDB_STORE);
                };
                request.onsuccess = function() { resolve(request.result); };
                request.onerror = function() { resolve(null); };
                request.onblocked = function() { resolve(null); };
            } catch (e) {
                resolve(null);
            }
        }).then(db => scopeImageDbToExam(db, getExamTokenFromURL())).catch(() => null);
        return imageDbPromise;
    }

    function idbRequest(mode, action) {
        return openImageDb().then(db => idbRawRequest(db, mode, action));
    }

    function idbGet(key)        { return idbRequest('readonly',  store => store.get(key)); }
    function idbPut(key, value) { return idbRequest('readwrite', store => store.put(value, key)); }
    function idbClear()         { return idbRequest('readwrite', store => store.clear()); }

    // ---- Fetch strategies ----
    function isImageBlob(blob) {
        return blob && blob.size > 0 && (blob.type || '').indexOf('image/') === 0;
    }

    async function fetchQuestionBlob(url) {
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const blob = await response.blob();
        if (!isImageBlob(blob)) throw new Error('Not an image');
        return blob;
    }

    function warmImageViaTag(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = function() { resolve(image); };
            image.onerror = function() { reject(new Error('Image failed to load')); };
            image.src = url;
        });
    }

    function storeCachedBlob(key, blob) {
        dropCachedUrl(key);
        const objectUrl = URL.createObjectURL(blob);
        cachedUrlByKey.set(key, objectUrl);

        // If this question is on screen and still waiting (or failed), swap the cached copy in
        const question = $scope.displayingQuestion;
        if (question && question.questionDisplayKey === key && ($scope.questionImageLoading || $scope.questionImageError)) {
            question.displayUrl = objectUrl;
            $scope.questionImageLoading = true;
            $scope.questionImageError = false;
            $scope.$applyAsync();
        }
    }

    async function cacheQuestionOnce(question) {
        const key = question.questionDisplayKey;

        // 1) Already persisted from an earlier page load?
        const storedBlob = await idbGet(key);
        if (isImageBlob(storedBlob)) {
            storeCachedBlob(key, storedBlob);
            return true;
        }

        // 2) Download as a blob (works when the image host allows CORS)
        try {
            const blob = await fetchQuestionBlob(question.url);
            storeCachedBlob(key, blob);
            idbPut(key, blob);
            return true;
        } catch (fetchError) {
            // 3) Fall back to warming the browser cache through an <img>
            const image = await warmImageViaTag(question.url);
            warmImageByKey.set(key, image);
            return true;
        }
    }

    async function cacheQuestionWithRetry(question, runId) {
        for (let attempt = 1; attempt <= CACHE_MAX_ATTEMPTS; attempt++) {
            if (runId !== preloadRunId) return false; // exam ended / restarted
            try {
                return await cacheQuestionOnce(question);
            } catch (e) {
                if (attempt < CACHE_MAX_ATTEMPTS) await wait(1500 * attempt);
            }
        }
        return false;
    }

    // Cache a single question (de-duplicated). Used by the preload queue and
    // as a priority bump whenever a question is opened before its turn.
    function ensureQuestionCached(question) {
        if (!question || !question.questionDisplayKey || !question.url) return Promise.resolve(false);
        const key = question.questionDisplayKey;
        if (isQuestionCached(key)) return Promise.resolve(true);
        if (cacheInFlight.has(key)) return cacheInFlight.get(key);

        const runId = preloadRunId;
        const promise = cacheQuestionWithRetry(question, runId)
            .catch(() => false)
            .finally(() => cacheInFlight.delete(key));
        cacheInFlight.set(key, promise);
        return promise;
    }

    // Build the download order: current question, rest of its section, then the other sections
    function buildPreloadOrder(examDetails, startSectionId, startQuestionId) {
        const ordered = [];
        const seen = new Set();
        const push = function(question) {
            if (question && question.questionDisplayKey && !seen.has(question.questionDisplayKey)) {
                seen.add(question.questionDisplayKey);
                ordered.push(question);
            }
        };

        const sectionIds = Object.keys(examDetails || {}).sort((a, b) => parseInt(a) - parseInt(b));
        const questionsOf = sectionId => Object.values((examDetails[sectionId] && examDetails[sectionId].questions) || {});

        if (examDetails && examDetails[startSectionId]) {
            const questions = examDetails[startSectionId].questions || {};
            push(questions[startQuestionId]);
            questionsOf(startSectionId).forEach(push);
        }
        sectionIds.forEach(sectionId => questionsOf(sectionId).forEach(push));

        return ordered;
    }

    $scope.preloadAllQuestions = function(startSectionId, startQuestionId) {
        const runId = ++preloadRunId;
        const queue = buildPreloadOrder($scope.examDetails, startSectionId, startQuestionId);

        $scope.questionCacheStatus = { total: queue.length, loaded: 0, failed: 0, done: queue.length === 0 };
        if (queue.length === 0) return;

        openImageDb().then(function() {
            let next = 0;
            const worker = async function() {
                while (next < queue.length && runId === preloadRunId) {
                    const question = queue[next++];
                    const ok = await ensureQuestionCached(question);
                    if (runId !== preloadRunId) return;
                    if (ok) $scope.questionCacheStatus.loaded++; else $scope.questionCacheStatus.failed++;
                    $scope.$applyAsync();
                }
            };

            const workers = [];
            for (let i = 0; i < CACHE_CONCURRENCY; i++) workers.push(worker());
            return Promise.all(workers);
        }).then(function() {
            if (runId !== preloadRunId) return;
            $scope.questionCacheStatus.done = true;
            $scope.$applyAsync();
        });
    };

    function clearQuestionCache() {
        preloadRunId++; // stops any running preload workers
        cachedUrlByKey.forEach(function(objectUrl) {
            try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        });
        cachedUrlByKey.clear();
        warmImageByKey.clear();
        cacheInFlight.clear();
        $scope.questionCacheStatus = { total: 0, loaded: 0, failed: 0, done: false };
        idbClear();
    }

    $scope.displayQuestionFromSection = function(sectionId, questionId) {
        //Show the "Question #N" placeholder until the new question image finishes loading
        $scope.questionImageLoading = true;
        $scope.questionImageError = false;

        $scope.questionsInSection = $scope.examDetails[sectionId].questions;
        $scope.displayingQuestion = $scope.questionsInSection[questionId];
        $scope.displayingQuestion.number = questionId;
        $scope.displayingQuestion.sectionId = sectionId;

        $scope.displayingQuestion.answer = $scope.findAlreadySubmittedAnswer($scope.displayingQuestion.questionDisplayKey);

        //Serve the image from the local cache when available, otherwise load it directly
        $scope.displayingQuestion.displayUrl = getQuestionDisplayUrl($scope.displayingQuestion);
        ensureQuestionCached($scope.displayingQuestion); //Priority bump if it is not cached yet
        imageRetryCount = 0;

        //Same image is already rendered (e.g. re-opening the current question): no load event will fire
        var questionImage = document.getElementById("questionAttemptImageContent");
        if (questionImage && questionImage.complete && questionImage.naturalWidth > 0 &&
            questionImage.getAttribute("src") === $scope.displayingQuestion.displayUrl) {
            $scope.questionImageLoading = false;
        }
    }

    //Hide the "Question #N" placeholder once the question image has loaded (or failed)
    const IMAGE_MAX_RETRIES = 3;
    let imageRetryCount = 0;
    angular.element(document).ready(function() {
        var questionImage = document.getElementById("questionAttemptImageContent");
        if (!questionImage) return;

        questionImage.addEventListener("load", function() {
            $scope.$applyAsync(function() {
                $scope.questionImageLoading = false;
                $scope.questionImageError = false;
            });
        });

        questionImage.addEventListener("error", function() {
            var question = $scope.displayingQuestion;
            var failedSrc = questionImage.getAttribute("src");
            if (!question || !failedSrc) return;

            //Retry a few times (keeps showing the "Question #N" placeholder) before giving up
            if (imageRetryCount < IMAGE_MAX_RETRIES) {
                imageRetryCount++;
                setTimeout(function() {
                    if ($scope.displayingQuestion !== question) return; //User moved on

                    if (failedSrc.indexOf("blob:") === 0) {
                        //Cached copy is unusable: drop it and go back to the original URL
                        dropCachedUrl(question.questionDisplayKey);
                    }

                    var retryUrl = getQuestionDisplayUrl(question);
                    if (retryUrl !== failedSrc) {
                        question.displayUrl = retryUrl; //ng-src picks up the new URL
                        $scope.$applyAsync();
                    } else {
                        questionImage.src = failedSrc; //Re-request the same URL
                    }
                }, 1500 * imageRetryCount);
                return;
            }

            $scope.$applyAsync(function() {
                $scope.questionImageLoading = false;
                $scope.questionImageError = true;
            });
        });
    });

    $scope.saveAndNext = function(currentSectionId, currentQuestionId, currentQuestionKey, answerOpted) {

        //Make it dynamic
        if(answerOpted != '' && answerOpted != 'A' && answerOpted != 'B' && answerOpted != 'C' && answerOpted != 'D') {
            return;
        }

        $scope.processAnswerSubmission(currentQuestionKey, answerOpted);

        var nextSection, nextQuestion;
        var numberOfQuestionsInCurrentSection = Object.keys($scope.examDetails[currentSectionId].questions).length;
        
        if(currentQuestionId == numberOfQuestionsInCurrentSection) { //Move to next section
            nextSection = parseInt(currentSectionId) + 1;

            var totalSections = parseInt($scope.examMetadata.numberOfSections);
            if(nextSection > totalSections) //End of exam
                return;


            $scope.loadSection(nextSection);
            return;
        } else {
            nextSection = currentSectionId;
            nextQuestion = parseInt(currentQuestionId) + 1
        }

        $scope.loadSectionWithQuestion(nextSection, nextQuestion);
    }


    $scope.getNumberOfQuestionsForReviewInCurrentSection = function() {

        const counts = {};
        Object.values($scope.answerDisplayContent).forEach(item => {
            const tValue = item.t;
            counts[tValue] = (counts[tValue] || 0) + 1;
        });

        for (let i = 0; i <= 4; i++) {
            counts[i] = counts[i] || 0;
        }

        return counts[2] + counts[3];
    }


    $scope.scrollQuestionByPercentage = function(percentage) {
        let img = document.getElementById("questionAttemptImageContent");
        let div = document.getElementById("questionAttemptImageDisplayUnit");
        let scrollAmount = div.scrollHeight * (percentage / 100);
        img.style.transform = `translateY(0px)`;

        div.scrollBy({ top: scrollAmount, behavior: "smooth" });
    }


    $scope.questionScrollButtonsVisible = false;
    $scope.showQuestionScrollButtons = function() {
        let img = document.getElementById("questionAttemptImageContent");
        let container = document.getElementById("questionAttemptImageDisplayUnit");
        if (!img || !container) return;

        setTimeout(() => {
            if (img.clientHeight > container.clientHeight) {
                $scope.questionScrollButtonsVisible = true;
            } else {
                $scope.questionScrollButtonsVisible = false;
            }
        }, 100);
    }

    $scope.scrollQuestionImageFromButton = function(amount) {
        // let img = document.getElementById("questionAttemptImageDisplayUnit");
        // img.style.transform = `translateY(${(parseInt(img.dataset.scroll || 0) + amount)}px)`;
        // img.dataset.scroll = parseInt(img.dataset.scroll || 0) + amount;
    

        let img = document.getElementById("questionAttemptImageContent");
        let container = document.getElementById("questionAttemptImageDisplayUnit");
        if (!img || !container) return;

        

        let maxScrollUp = 0;  // Top limit (no scroll beyond this)
        let maxScrollDown = container.clientHeight - img.clientHeight;  // Bottom limit

        let currentScroll = parseInt(img.dataset.scroll || 0);
        let newScroll = currentScroll + amount;

        // Prevent over-scrolling
        if (newScroll > maxScrollUp) newScroll = maxScrollUp;
        if (newScroll < maxScrollDown) newScroll = maxScrollDown;

        img.style.transform = `translateY(${newScroll}px)`;
        img.dataset.scroll = newScroll;
    }




    //Currently opened Question and Section (use for seeking thru Questions only)
    $scope.currentOpenQuestion = 0;
    $scope.currentOpenSection = 0;
    $scope.moveQuestionRight = function(source) {
        if($scope.currentOpenQuestion < 1 || $scope.currentOpenSection < 1) {
            return;
        }

        var currentSection = $scope.examDetails[$scope.currentOpenSection];
        if(!currentSection) {
            return;
        }

        var questionsInSection = currentSection.questions;
        if(!questionsInSection || !questionsInSection[$scope.currentOpenQuestion]) {
            return;
        }

        var nextSection = $scope.currentOpenSection;
        var nextQuestion = $scope.currentOpenQuestion + 1;
        if(nextQuestion > Object.keys(questionsInSection).length) {
            nextQuestion = 1; //and move to next section
            nextSection = parseInt(nextSection) + 1;

            var totalSectionsPresent = Object.keys($scope.examDetails).length;
            if(nextSection > totalSectionsPresent) {
                return; //Do nothing, last question of the exam
            }
        }

        $scope.loadSectionWithQuestion(nextSection, nextQuestion);


        // Auto-scroll without Y-axis movement
        setTimeout(() => {
            let container = document.querySelector(".sectionSeekerContainer");
            let activeButton = container?.querySelector(".questionSectionButtonActive");

            if (activeButton) {
                activeButton.scrollIntoView({ 
                    behavior: "smooth", 
                    inline: "center",  // Ensures horizontal centering
                    block: "nearest"   // Prevents unnecessary vertical scrolling
                });
            }
        }, 100);
    }

    $scope.moveQuestionLeft = function(source) {
        if($scope.currentOpenQuestion < 1 || $scope.currentOpenSection < 1) {
            return;
        }

        var currentSection = $scope.examDetails[$scope.currentOpenSection];
        if(!currentSection) {
            return;
        }

        var questionsInSection = currentSection.questions;
        if(!questionsInSection || !questionsInSection[$scope.currentOpenQuestion]) {
            return;
        }

        var nextSection = $scope.currentOpenSection;
        var nextQuestion = $scope.currentOpenQuestion - 1;
        if(nextQuestion < 1) {
            nextSection = parseInt(nextSection) - 1;
            if(nextSection < 1) {
                return; //Do nothing, first question of the exam
            }

            var nextSectionData = $scope.examDetails[nextSection];
            nextQuestion = Object.keys(nextSectionData.questions).length; //move to prev sections last question
        }

        $scope.loadSectionWithQuestion(nextSection, nextQuestion);


        // Auto-scroll without Y-axis movement
        setTimeout(() => {
            let container = document.querySelector(".sectionSeekerContainer");
            let activeButton = container?.querySelector(".questionSectionButtonActive");

            if (activeButton) {
                activeButton.scrollIntoView({ 
                    behavior: "smooth", 
                    inline: "center",  
                    block: "nearest"  
                });
            }
        }, 100);


    }

    $scope.loadSectionWithQuestion = function(sectionId, questionId) {
        $scope.currentSection = $scope.examDetails[sectionId];
        if(!$scope.currentSection) {
            $scope.loadSectionWithQuestion(1,1);
            return;
        }
        $scope.currentSection.id = sectionId;

        $scope.questionsInSection = $scope.currentSection.questions;
        if(!$scope.questionsInSection || !$scope.questionsInSection[questionId]) {
            $scope.loadSectionWithQuestion(1,1);
            return;
        }

        $scope.markQuestionAsVisited($scope.questionsInSection[questionId].questionDisplayKey);

        localStorage.setItem("currentSectionOpen", sectionId);

        $scope.displayQuestionFromSection(sectionId, questionId); //First question of the section

        $scope.currentOpenQuestion = questionId;
        $scope.currentOpenSection = sectionId;

        //Update URL param
        const url = new URL(window.location);
        url.searchParams.set("section", sectionId);
        url.searchParams.set("question", questionId);
        window.history.pushState({}, '', url);

        $scope.scrollQuestionByPercentage(0); //Set image to original place
        $scope.showQuestionScrollButtons(); //Enable scroll image buttons
    }

    // $scope.loadSection = function(sectionId) {
    //     $scope.loadSectionWithQuestion(sectionId, 1); //First question of the section
    // }

    // $scope.moveSectionLeft = function() {
    //     var currentSection = localStorage.getItem("currentSectionOpen") ? localStorage.getItem("currentSectionOpen") : 1;
    //     currentSection--;

    //     if(currentSection < 1)
    //         currentSection = 1;
    //     $scope.loadSection(currentSection);
    // }

    // $scope.moveSectionRight = function() {
    //     var currentSection = localStorage.getItem("currentSectionOpen") ? localStorage.getItem("currentSectionOpen") : 1;
    //     currentSection++;

    //     if(currentSection > $scope.sectionDetails.length)
    //         currentSection = $scope.sectionDetails.length;
    //     $scope.loadSection(currentSection);
    // }



    //To kill them in the end
    $scope.allRunningTimers = [];

    $scope.loadSection = function(sectionId) {
        $scope.loadSectionWithQuestion(sectionId, 1); // Load the first question of the section

        // Auto-scroll the active button into the center
        setTimeout(() => {
            let container = document.querySelector(".sectionSeekerContainer");
            let activeButton = container?.querySelector(".questionSectionButtonActive");

            if (activeButton) {
                activeButton.scrollIntoView({ 
                    behavior: "smooth", 
                    inline: "center",  // Ensures horizontal centering
                    block: "nearest"   // Prevents vertical scrolling
                });
            }
        }, 100);
    };


    $scope.moveSectionLeft = function() {
        var currentSection = localStorage.getItem("currentSectionOpen") ? parseInt(localStorage.getItem("currentSectionOpen")) : 1;
        currentSection--;

        if (currentSection < 1) {
            currentSection = 1;
        }

        localStorage.setItem("currentSectionOpen", currentSection);
        $scope.loadSection(currentSection);

        // Auto-scroll without Y-axis movement
        setTimeout(() => {
            let container = document.querySelector(".sectionSeekerContainer");
            let activeButton = container?.querySelector(".questionSectionButtonActive");

            if (activeButton) {
                activeButton.scrollIntoView({ 
                    behavior: "smooth", 
                    inline: "center",  
                    block: "nearest"  
                });
            }
        }, 100);
    };


    $scope.moveSectionRight = function() {
        var currentSection = localStorage.getItem("currentSectionOpen") ? parseInt(localStorage.getItem("currentSectionOpen")) : 1;
        currentSection++;

        if (currentSection > $scope.sectionDetails.length) {
            currentSection = $scope.sectionDetails.length;
        }

        localStorage.setItem("currentSectionOpen", currentSection);
        $scope.loadSection(currentSection);

        // Auto-scroll without Y-axis movement
        setTimeout(() => {
            let container = document.querySelector(".sectionSeekerContainer");
            let activeButton = container?.querySelector(".questionSectionButtonActive");

            if (activeButton) {
                activeButton.scrollIntoView({ 
                    behavior: "smooth", 
                    inline: "center",  // Ensures horizontal centering
                    block: "nearest"   // Prevents unnecessary vertical scrolling
                });
            }
        }, 100);
    };



    function isExamLocalDataAbsent() {
        return (
            localStorage.getItem("questionTimeTracker") === null ||
            localStorage.getItem("examSubmissionData") === null ||
            localStorage.getItem("crisprMockTestToken") === null
        );
    }


    function rememberExamToken() {
        var currentToken = localStorage.getItem("crisprMockTestToken") ? localStorage.getItem("crisprMockTestToken") : null;
        if(!currentToken || currentToken == null) { //Do not override
            var examToken = getExamTokenFromURL();
            localStorage.setItem("crisprMockTestToken", examToken);
        }
    }

    
    $scope.getExamCacheClearConfirmation = function(previousExamToken) {
        bootbox.confirm({
                title: "<p style='color: #444; font-size: 24px; margin: 0; font-weight: bold;'>Conflicting Exams Found</p>",
                message: "<p style='color: #444; font-size: 18px; font-weight: 300; line-height: 28px;'>The system detected that you exited a previous exam without submitting it. To ensure your progress is saved, please return and submit that exam first. If you choose to proceed with this new exam, you may lose any unsaved progress from your previous exam.</p>",
                buttons: {
                    cancel: {
                        label: "Visit Previous Test",
                        className: "btn-default" // Red button
                    },
                    confirm: {
                        label: "Start New",
                        className: "btn-success"
                    }
                },
                callback: function (result) {
                    if(result) {
                        //Clear Cached local storage and continue
                        clearAllExamRelatedStorage();
                        
                        setTimeout(function() {
                            $scope.initialiseExam();
                        }, 200);
                    } else {
                        //Go back to old exam
                        const url = new URL(window.location.href);
                        url.searchParams.set('quiz', previousExamToken);
                        window.history.replaceState(null, '', url.toString());

                        setTimeout(function() {
                            location.reload();
                        }, 200);
                    }
                }
            });
    }



    $scope.checkForTokenMismatch = function() {
        var currentToken = localStorage.getItem("crisprMockTestToken") ? localStorage.getItem("crisprMockTestToken") : null;
        if((currentToken && currentToken != null && currentToken != '') && currentToken != getExamTokenFromURL()) { //Already another token present
            //Found another other exam, ask user to clear the cache
            $scope.getExamCacheClearConfirmation(currentToken);
            return;
        }        
    }

    function isValidExamFound() { //no exam token conflicts
        var currentToken = localStorage.getItem("crisprMockTestToken") ? localStorage.getItem("crisprMockTestToken") : null;
        return currentToken == getExamTokenFromURL();
    }

    $scope.loadLastSubmissionDataFromServer = function() {

        console.log('pulling submission from server')

        let browserFingerprint = {
            screenWidth: screen.width,
            screenHeight: screen.height,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: navigator.language,
            platform: navigator.platform,
            cpuCores: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory || "unknown",
        };

        var data = {
            token : getExamTokenFromURL(),
            fingerprint: browserFingerprint
        }
        $http({
          method  : 'POST',
          url     : 'https://crisprtech.app/crispr-apis/user/quiz/fetch-latest-submission.php',
          data    :  data,
          headers : {
            'Content-Type': 'application/json',
            'Authorization': "Bearer " + getUserToken()
          }
         })
         .then(function(response) {
            if(response.data.status == "success"){
                var submissionData = response.data.data;

                let timeData = {};
                let answerData = {};

                for (let key in submissionData) {
                    if (submissionData.hasOwnProperty(key)) {
                        timeData[key] = parseInt(submissionData[key].ts);
                    }

                    if (submissionData[key].t > 0) {
                        answerData[key] = {
                            t: submissionData[key].t,
                            a: submissionData[key].a
                        };
                    }
                }

                localStorage.setItem("questionTimeTracker", JSON.stringify(timeData));
                localStorage.setItem("examSubmissionData", JSON.stringify(answerData));

                $scope.loadSectionWithQuestion(sectionId, questionId);
            }
        });
    }

    $scope.initialiseExam = function(){

        //Exam attempting and intended token are matching (to avoid conflicts)
        $scope.checkForTokenMismatch();

        let browserFingerprint = {
            screenWidth: screen.width,
            screenHeight: screen.height,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: navigator.language,
            platform: navigator.platform,
            cpuCores: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory || "unknown",
        };

        var data = {
            token : getExamTokenFromURL(),
            fingerprint: browserFingerprint
        }
        $http({
          method  : 'POST',
          url     : 'https://crisprtech.app/crispr-apis/user/quiz/fetch-quiz.php',
          data    :  data,
          headers : {
            'Content-Type': 'application/json',
            'Authorization': "Bearer " + getUserToken()
          }
         })
         .then(function(response) {
            if(response.data.status == "success"){

                rememberExamToken(); //to prevent exam interruption

                $scope.examDetails = response.data.data;
                $scope.examDetailsFound = true;
                $scope.examMetadata = response.data.metadata;

                $scope.updateSectionNamesList($scope.examDetails);

                //Check if viewing specific question (refresh cases)
                const urlParams = new URLSearchParams(window.location.search);
                var sectionId = decodeURIComponent(urlParams.get('section'));
                if(!sectionId) sectionId = 1;

                var questionId = decodeURIComponent(urlParams.get('question'));
                if(!questionId) questionId = 1;

                $scope.loadSectionWithQuestion(sectionId, questionId);
                //$scope.answerDisplayContentRefresh();

                //Pre-fetch every question image so navigation no longer depends on the network
                $scope.preloadAllQuestions($scope.currentOpenSection, $scope.currentOpenQuestion);

                //Start Exam Timer
                const totalTimeRemaining = $scope.examMetadata.endTime - $scope.examMetadata.currentTime;
                const display1 = document.querySelector('#timerCountDown1');
                const display2 = document.querySelector('#timerCountDown2');
                $scope.startTimer(totalTimeRemaining, display1, display2);

                if(isExamLocalDataAbsent()) {
                    $scope.loadLastSubmissionDataFromServer(sectionId, questionId);
                }
            } else {
                $scope.examDetailsFound = false;
                document.getElementById("examErrorBanner").style.display = 'flex';
            }
        });
    
    }


    //Default first method call
    $scope.initialiseExam();


    //Question level progress tracker
    $scope.getProgressBarClass = function() {
        if (!$scope.currentQuestionAnswered) {
            if ($scope.currentQuestionTimePercentageLapsed <= 60) {
                return 'progress-bar-success';
            } else if ($scope.currentQuestionTimePercentageLapsed >= 90) {
                return 'progress-bar-danger';
            } else {
                return 'progress-bar-warning';
            }
        }
        
        return '';
    };

    $scope.$watchGroup([
      'currentQuestionTimePercentageLapsed',
      'currentQuestionTimeLapsed',
      'currentQuestionAnswered'
    ], function() {
        $scope.progressBarClass = $scope.getProgressBarClass();
    });


    //Force Submite the Exam
    $scope.forceSubmitExam = function() {
        $scope.saveExamProgress("TERMINATE");
    }

    $scope.findAlreadySubmittedAnswer = function(questionKey) {
        var examSubmissionData = localStorage.getItem("examSubmissionData") ? JSON.parse(localStorage.getItem("examSubmissionData")) : {};
        if(examSubmissionData[questionKey]) {
            var questionSubmission = examSubmissionData[questionKey];
            return questionSubmission.a;
        }
    }


    /***
     * "t" -> 0: Not Answered / 1: For Review Only / 2: Answered And Review / 3: Answered
    ***/
    $scope.processAnswerSubmission = function(questionKey, answerOpted) {
        var examSubmissionData = localStorage.getItem("examSubmissionData") ? JSON.parse(localStorage.getItem("examSubmissionData")) : {};
        examSubmissionData[questionKey] = {
            "t": answerOpted == '' ? ANSWER_MODES.NOT_ANSWERED : ANSWER_MODES.ANSWERED,
            "a": answerOpted
        }
        localStorage.setItem("examSubmissionData", JSON.stringify(examSubmissionData));
        $scope.answerDisplayContentRefresh();
    }


    //Questions Listing - Answered Questions
    $scope.answerDisplayContent = {};
    $scope.answerDisplayContentRefresh = function() {
        var examSubmissionData = localStorage.getItem("examSubmissionData") ? JSON.parse(localStorage.getItem("examSubmissionData")) : {};
        var questions = $scope.examDetails[1].questions;

        for (const key in questions) {
            const questionDisplayKey = questions[key].questionDisplayKey;
            if (!examSubmissionData.hasOwnProperty(questionDisplayKey)) {
                examSubmissionData[questionDisplayKey] = { t: 0, a: "" };
            }
        }

        $scope.answerDisplayContent = examSubmissionData;
    }

    $scope.answerDisplaySummaryMatric = function(type) {
        const counts = {};
        Object.values($scope.answerDisplayContent).forEach(item => {
            const tValue = item.t;
            counts[tValue] = (counts[tValue] || 0) + 1;
        });

        for (let i = 0; i <= 4; i++) {
            counts[i] = counts[i] || 0;
        }

        return counts[type];
    }


    $scope.markQuestionAsVisited = function(questionKey) {
        var examSubmissionData = localStorage.getItem("examSubmissionData") ? JSON.parse(localStorage.getItem("examSubmissionData")) : {};
        if(!examSubmissionData[questionKey] || examSubmissionData[questionKey].t == 0) {
            examSubmissionData[questionKey] = {
                "t": ANSWER_MODES.NOT_ANSWERED,
                "a": ""
            }
        }
        localStorage.setItem("examSubmissionData", JSON.stringify(examSubmissionData));
        $scope.answerDisplayContentRefresh();
    }

    $scope.markForReviewAndNext = function(currentSectionId, currentQuestionId, questionKey, answerOpted) {
        //Make it dynamic
        var answerRightly = true;
        if(answerOpted != 'A' && answerOpted != 'B' && answerOpted != 'C' && answerOpted != 'D') {
            answerRightly = false;
            answerOpted = "";
        }

        var examSubmissionData = localStorage.getItem("examSubmissionData") ? JSON.parse(localStorage.getItem("examSubmissionData")) : {};
        if(examSubmissionData[questionKey]) {
            examSubmissionData[questionKey] = {
                "t": answerRightly ? ANSWER_MODES.ANSWERED_FOR_REVIEW : ANSWER_MODES.FOR_REVIEW,
                "a": answerOpted
            }
        }
        localStorage.setItem("examSubmissionData", JSON.stringify(examSubmissionData));
        $scope.answerDisplayContentRefresh();

        var nextSection, nextQuestion;
        var numberOfQuestionsInCurrentSection = Object.keys($scope.examDetails[currentSectionId].questions).length;
        
        if(currentQuestionId == numberOfQuestionsInCurrentSection) { //Move to next section
            nextSection = parseInt(currentSectionId) + 1;

            var totalSections = parseInt($scope.examMetadata.numberOfSections);
            if(nextSection > totalSections) //End of exam
                return;


            $scope.loadSection(nextSection);
            return;
        } else {
            nextSection = currentSectionId;
            nextQuestion = parseInt(currentQuestionId) + 1
        }

        $scope.loadSectionWithQuestion(nextSection, nextQuestion);
    }


    $scope.submitCurrentQuestionAnswer = function(questionKey, answerOpted) {
        $scope.displayingQuestion.answer = answerOpted;
        var examSubmissionData = localStorage.getItem("examSubmissionData") ? JSON.parse(localStorage.getItem("examSubmissionData")) : {};
        if(!examSubmissionData[questionKey] || examSubmissionData[questionKey].t == 0) {
            examSubmissionData[questionKey] = {
                "t": ANSWER_MODES.ANSWERED,
                "a": answerOpted
            }
        }
        localStorage.setItem("examSubmissionData", JSON.stringify(examSubmissionData));
        $scope.answerDisplayContentRefresh();  
    }

    $scope.clearResponseForQuestion = function(questionKey) {
        $scope.displayingQuestion.answer = '';
        var examSubmissionData = localStorage.getItem("examSubmissionData") ? JSON.parse(localStorage.getItem("examSubmissionData")) : {};
        if(examSubmissionData[questionKey]) {
            examSubmissionData[questionKey] = {
                "t": ANSWER_MODES.NOT_ANSWERED,
                "a": ''
            }
        }
        localStorage.setItem("examSubmissionData", JSON.stringify(examSubmissionData));
        $scope.answerDisplayContentRefresh();  
    }

    // $scope.getAnswerDisplayButton = function(questionKey) {
    //     const statusMap = {
    //         0: "notVisited",
    //         1: "questionNotAnswered",
    //         2: "markedForRevew",
    //         3: "answeredAndMarkedForRevew",
    //         4: "questionAnswered"
    //     };

    //     const status = $scope.answerDisplayContent?.[questionKey]?.t;
    //     return statusMap[status] || "notVisited";
    // };

    $scope.getAnswerDisplayButton = function(questionKey) {
        const statusMap = {
            0: "notVisited",
            1: "questionNotAnswered",
            2: "markedForRevew",
            3: "answeredAndMarkedForRevew",
            4: "questionAnswered"
        };

        const question = $scope.answerDisplayContent?.[questionKey];

        if (!question) return "notVisited";

        if (question.t === 2 || (question.t === 3 && question.a === "")) {
            return "markedForRevew";
        }

        return statusMap[question.t] || "notVisited";
    };



    // EXAM COUNT DOWN
    $scope.startTimer = function(duration, display1, display2) {
        let timer = duration, hours, minutes, seconds;
        const hoursSpan1 = display1.querySelector('.hours');
        const minutesSpan1 = display1.querySelector('.minutes');
        const secondsSpan1 = display1.querySelector('.seconds');
        const colons1 = display1.querySelectorAll('.blink');

        const hoursSpan2 = display2.querySelector('.hours');
        const minutesSpan2 = display2.querySelector('.minutes');
        const secondsSpan2 = display2.querySelector('.seconds');
        const colons2 = display2.querySelectorAll('.blink');
        
        var examTimeTickerTimer = $interval(function() {
            //Calculate Current Questions Progress
            $scope.currentQuestionKey = $scope.displayingQuestion.questionDisplayKey;
            var currentStampData = localStorage.getItem("questionTimeTracker") ? JSON.parse(localStorage.getItem("questionTimeTracker")) : {};
            var timeSpentOnQuestion = currentStampData[$scope.currentQuestionKey];
            var percentage = ((timeSpentOnQuestion / $scope.displayingQuestion.averageTimeToSolveProblem) * 100).toFixed(0);
            if(percentage > 100)
                percentage = 100;

            $scope.currentQuestionTimePercentageLapsed = percentage;

            $scope.trackIndividualQuestionTime();

            //Track user last active time (to manage exam data)
            localStorage.setItem("userLastActiveTime", Math.floor(new Date().getTime() / 1000));


            //Update overall counter
            $scope.examTimeRemaining = timer;
            hours1 = parseInt(timer / 3600, 10);
            minutes1 = parseInt((timer % 3600) / 60, 10);
            seconds1 = parseInt(timer % 60, 10);

            hoursSpan1.textContent = hours1 < 10 ? "0" + hours1 : hours1;
            minutesSpan1.textContent = minutes1 < 10 ? "0" + minutes1 : minutes1;
            secondsSpan1.textContent = seconds1 < 10 ? "0" + seconds1 : seconds1;

            hours2 = parseInt(timer / 3600, 10);
            minutes2 = parseInt((timer % 3600) / 60, 10);
            seconds2 = parseInt(timer % 60, 10);

            hoursSpan2.textContent = hours2 < 10 ? "0" + hours2 : hours2;
            minutesSpan2.textContent = minutes2 < 10 ? "0" + minutes2 : minutes2;
            secondsSpan2.textContent = seconds2 < 10 ? "0" + seconds2 : seconds2;


            if (--timer < 0) {
                $interval.cancel(examTimeTickerTimer);
                hoursSpan1.textContent = "00";
                minutesSpan1.textContent = "00";
                secondsSpan1.textContent = "00";

                hoursSpan2.textContent = "00";
                minutesSpan2.textContent = "00";
                secondsSpan2.textContent = "00";
                $scope.forceSubmitExam(); //Auto Submit
            }

            //Red Timer Alerting
            if($scope.criprInsightsEnabled) {
                if(hours == 0 && minutes < 2) { //less than 1 minute left
                    document.getElementById("timerContainer").classList.add("blinkingRed");
                    document.getElementById("timerContainer").classList.remove("blinkingRedStopped");
                }
                if(hours == 0 && minutes == 0 && seconds < 10) { //less than 10 seconds
                    document.getElementById("timerContainer").classList.remove("blinkingRed");
                    document.getElementById("timerContainer").classList.add("blinkingRedStopped");
                }
            }

        }, 1000);

        $scope.allRunningTimers.push(examTimeTickerTimer);
    }



    //SUBMIT FINAL

    function combineSubmissionData(submissionData, timeTrackerData) {
        let result = {};
        
        // Process submissionData
        for (let key in submissionData) {
            let { t, a } = submissionData[key];
            
            if (timeTrackerData.hasOwnProperty(key)) {
                result[key] = {
                    t: t,
                    ts: timeTrackerData[key],
                    a: a
                };
            }
        }
        
        // Include remaining keys from timeTrackerData
        for (let key in timeTrackerData) {
            if (!result.hasOwnProperty(key)) {
                result[key] = {
                    t: 1,
                    ts: timeTrackerData[key],
                    a: ""
                };
            }
        }
        
        return result;
    }

    $scope.countdownElement = document.getElementById("countdown");

    // e.g. 950 -> "15m 50s", 4550 -> "1h 15m 50s"
    function formatRemainingTime(totalSeconds) {
        totalSeconds = Math.max(0, parseInt(totalSeconds, 10) || 0);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return (hours > 0 ? hours + "h " : "") + minutes + "m " + seconds + "s";
    }

    $scope.submitExamConfirmation = function() {
        const timeLeftText = $scope.examTimeRemaining !== undefined
            ? " You still have <b>" + formatRemainingTime($scope.examTimeRemaining) + "</b> left on the timer."
            : "";
        bootbox.confirm({
                title: "<p style='color: red; font-size: 24px; margin: 0; font-weight: bold;'>Are you sure want to Submit this Exam?</p>",
                message: "<p style='color: #444; font-size: 18px; font-weight: 300; line-height: 28px;'>If you proceed, the exam will end immediately." + timeLeftText + " Once submitted, you won’t be able to retake this test for the next 48 hours. Are you sure you want to continue submitting the exam?<br><br><b>Note: You can take a break if needed, but the timer will keep running.</b></p>",
                buttons: {
                    cancel: {
                        label: "Continue Exam",
                        className: "btn-default" // Red button
                    },
                    confirm: {
                        label: "Submit Exam",
                        className: "btn-success"
                    }
                },
                callback: function (result) {
                    if(result) {
                        $scope.countdownElement.textContent = "Submitting";
                        $scope.showSubmitRetryBanner = false;
                        $scope.saveExamProgress("TERMINATE", true);
                    } else {
                        document.getElementById("submit-exam-button-1").classList.remove("active");
                        $scope.countdownElement.textContent = "Submit Exam"
                    }
                }
            });
    }



        //For Main Timer 1 (Web View)
        $scope.getExamConfirmation = function() {
            document.getElementById("submit-exam-button-1").classList.add("active");
            $scope.submitExamConfirmation();
        };


    //Clear exam related data
    function clearAllExamRelatedStorage() {
        localStorage.removeItem("currentSectionOpen");
        localStorage.removeItem("questionTimeTracker");
        localStorage.removeItem("examSubmissionData");
        localStorage.removeItem("userLastActiveTime");
        localStorage.removeItem("crisprMockTestToken"); 
        localStorage.removeItem("tabSwitchViolations");
        clearQuestionCache();
    }

    function renderExamCompleteScreen(reportURL) {
        //Kill all the running timers
        angular.forEach($scope.allRunningTimers, function(timer) {
            $interval.cancel(timer);
        });
        $scope.allRunningTimers = [];

        $scope.examDetailsFound = false;
        clearAllExamRelatedStorage();
        document.getElementById("examCompletedBanner").style.display = 'flex';
        if(reportURL) {
            document.getElementById("examCompletedBannerReport").setAttribute( "onclick", "window.location.replace('" + reportURL + "')" );
        } else {
            document.getElementById("examCompletedBannerReport").setAttribute( "onclick", "window.location.href = 'https://candidate.crisprlearning.com/'" );
        }
    }

    // Consecutive save-progress network failures; red banner shows at the threshold,
    // and a green "Back Online" banner briefly confirms recovery.
    const SAVE_FAILURE_BANNER_THRESHOLD = 10;
    const BACK_ONLINE_BANNER_MS = 4000;
    let consecutiveSaveFailures = 0;
    let backOnlineBannerPromise = null;
    $scope.showNetworkUnstableBanner = false;
    $scope.showBackOnlineBanner = false;
    $scope.showSubmitRetryBanner = false; // Yellow banner: manual "Submit Exam" hit a network error

    function onSaveProgressReachedServer() {
        $scope.showSubmitRetryBanner = false;
        if (consecutiveSaveFailures >= SAVE_FAILURE_BANNER_THRESHOLD) {
            $scope.showNetworkUnstableBanner = false;
            $scope.showBackOnlineBanner = true;
            $timeout.cancel(backOnlineBannerPromise);
            backOnlineBannerPromise = $timeout(function() {
                $scope.showBackOnlineBanner = false;
            }, BACK_ONLINE_BANNER_MS);
        }
        consecutiveSaveFailures = 0;
    }

    function onSaveProgressNetworkError() {
        consecutiveSaveFailures++;
        if (consecutiveSaveFailures >= SAVE_FAILURE_BANNER_THRESHOLD) {
            $timeout.cancel(backOnlineBannerPromise);
            $scope.showBackOnlineBanner = false;
            $scope.showNetworkUnstableBanner = true;
        }
    }

    $scope.saveExamProgress = function(endExamFlag, isManualSubmit) { //Note: also auto-save every 30s

        var examSubmissionData = localStorage.getItem("examSubmissionData") ? JSON.parse(localStorage.getItem("examSubmissionData")) : {};
        var timestampData = localStorage.getItem("questionTimeTracker") ? JSON.parse(localStorage.getItem("questionTimeTracker")) : {};


        const finalData = {};
        const processedKeys = new Set();

        // Step 1: Iterate over examSubmissionData and find corresponding time from timestampData
        for (const [questionId, data] of Object.entries(examSubmissionData)) {
            if (timestampData.hasOwnProperty(questionId)) {
                finalData[questionId] = {
                    "ts": timestampData[questionId],
                    "a": data["a"]
                };
                processedKeys.add(questionId);  // Mark this key as processed
            }
        }

        // Step 2: Add remaining keys from timestampData
        for (const [questionId, timeSpent] of Object.entries(timestampData)) {
            if (!processedKeys.has(questionId)) {
                finalData[questionId] = {
                    "ts": timeSpent,
                    "a": ""
                };
            }
        }


        let browserFingerprint = {
            screenWidth: screen.width,
            screenHeight: screen.height,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: navigator.language,
            platform: navigator.platform,
            cpuCores: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory || "unknown",
        };

        var data = {
            token : getExamTokenFromURL(),
            data : combineSubmissionData(examSubmissionData, timestampData),
            endExam : (endExamFlag == "TERMINATE" ? 1 : 0),
            fingerprint: browserFingerprint
        }

        $http({
          method  : 'POST',
          url     : 'https://crisprtech.app/crispr-apis/user/quiz/save-progress.php',
          data    :  data,
          headers : {
            'Content-Type': 'application/json',
            'Authorization': "Bearer " + getUserToken()
          }
         })
         .then(function(response) {
            onSaveProgressReachedServer();

            if(response.data.status == "success"){
                if(response.data.data.submitted) { //The exam got submitted
                    renderExamCompleteScreen(response.data.data.reportURL);
                }
            } else if((response.data.status == "failed" || response.data.status == "error") && response.data.message == "Exam has already ended") {
                renderExamCompleteScreen();
            } else {
                location.reload(); //Save failed (reload)
            }
        }, function() {
            // Network error / no response from the server
            onSaveProgressNetworkError();

            if (isManualSubmit) { // Let the user retry the submission
                $scope.showSubmitRetryBanner = true;
                $scope.countdownElement.textContent = "Submit Exam";
                document.getElementById("submit-exam-button-1").classList.remove("active");
            }
        });
    }



    var autoSaveTimer = $interval(function() {
        if(isValidExamFound()) { //save if exam found only
            $scope.saveExamProgress();
        }
    }, 10000);

    $scope.allRunningTimers.push(autoSaveTimer);

});