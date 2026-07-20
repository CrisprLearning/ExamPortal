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
        return decodeURIComponent(urlParams.get('token'));
    }

    function getExamTokenFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        return decodeURIComponent(urlParams.get('quiz'));
    }



    let isBootboxVisible = false; // Flag to track modal visibility
    document.addEventListener("visibilitychange", function() {
        if (document.hidden && !isBootboxVisible) {
            isBootboxVisible = true; // Set flag to prevent multiple modals

            bootbox.confirm({
                title: "<p style='color: #ff9800; font-size: 24px; margin: 0; font-weight: bold;'>Warning!</p>",
                message: "<p style='color: #444; font-size: 18px; font-weight: 300; line-height: 28px;'>While attempting the test, switching between tabs is strictly prohibited. If you navigate away, it may be considered a violation. Additionally, the timer continues running even if you take a break, and once the allotted time expires, the exam will be auto-submitted. Stay focused to maximize your performance.</p>",
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
    });



    //Defaults
    $scope.examDetails = {};
    $scope.examMetadata = {};
    $scope.sectionDetails = [];
    $scope.currentSection = {};
    $scope.questionsInSection = [];
    $scope.displayingQuestion = {};

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

    $scope.displayQuestionFromSection = function(sectionId, questionId) {
        $scope.questionsInSection = $scope.examDetails[sectionId].questions;
        $scope.displayingQuestion = $scope.questionsInSection[questionId];
        $scope.displayingQuestion.number = questionId;
        $scope.displayingQuestion.sectionId = sectionId;

        $scope.displayingQuestion.answer = $scope.findAlreadySubmittedAnswer($scope.displayingQuestion.questionDisplayKey);
    }

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
                        url.searchParams.set('exam', encodeURIComponent(previousExamToken));
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

    $scope.countdown = 5;
    $scope.countdownElement = document.getElementById("countdown");
    $scope.isSubmitClicked = false;

    $scope.submitExamConfirmation = function() {
        bootbox.confirm({
                title: "<p style='color: red; font-size: 24px; margin: 0; font-weight: bold;'>Confirm Submission</p>",
                message: "<p style='color: #444; font-size: 18px; font-weight: 300; line-height: 28px;'>If you proceed, the exam will end immediately. Once submitted, you won’t be able to retake this test for the next 48 hours. Are you sure you want to continue submitting the exam?<br><br><b>Note: You can take a break if needed, but the timer will keep running.</b></p>",
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
                        $scope.saveExamProgress("TERMINATE");
                    } else {
                        document.getElementById("submit-exam-button-1").classList.remove("active");
                        $scope.countdownElement.textContent = "Submit Exam"
                        $scope.countdown = 5;
                        $scope.isSubmitClicked = false;
                    }
                }
            });
    }



        //For Main Timer 1 (Web View)
        $scope.getExamConfirmation = function() {
            if ($scope.isSubmitClicked) {
                // If clicked again during countdown, cancel submission
                $scope.isSubmitClicked = false;
                $timeout.cancel($scope.countdownPromise); // Cancel the timeout
                $scope.countdownElement.textContent = "Submit Exam";
                document.getElementById("submit-exam-button-1").classList.remove("active");
                return;
            }

            // First click: Start countdown
            $scope.isSubmitClicked = true;
            document.getElementById("submit-exam-button-1").classList.add("active");

            $scope.countdown = 5;
            $scope.countdownElement.textContent = `Click again to Cancel (${$scope.countdown}s)`;

            $scope.startCountdown = function() {
                $scope.countdown--;

                if ($scope.countdown > 0) {
                    $scope.countdownElement.textContent = `Click again to Cancel (${$scope.countdown}s)`
                    $scope.countdownPromise = $timeout($scope.startCountdown, 1000);
                } else {
                    $scope.countdownElement.textContent = "Confirm Submission";
                    $scope.submitExamConfirmation();
                }
            };

            $scope.countdownPromise = $timeout($scope.startCountdown, 1000);
        };


    //Clear exam related data
    function clearAllExamRelatedStorage() {
        localStorage.removeItem("currentSectionOpen");
        localStorage.removeItem("questionTimeTracker");
        localStorage.removeItem("examSubmissionData");
        localStorage.removeItem("userLastActiveTime");
        localStorage.removeItem("crisprMockTestToken"); 
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

    $scope.saveExamProgress = function(endExamFlag) { //Note: also auto-save every 30s

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
            if(response.data.status == "success"){
                if(response.data.data.submitted) { //The exam got submitted
                    renderExamCompleteScreen(response.data.data.reportURL);
                }
            } else if((response.data.status == "failed" || response.data.status == "error") && response.data.message == "Exam has already ended") {
                renderExamCompleteScreen();
            } else {
                location.reload(); //Save failed (reload)
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