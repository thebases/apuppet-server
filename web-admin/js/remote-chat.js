function RemoteChat(chatElem, chatForm, messageInput, sendButton) {
    this.textroom = null;
    this.chatElem = chatElem;
    this.chatForm = chatForm;
    this.messageInput = messageInput;
    this.sendButton = sendButton;

    this.transactions = {};
    this.participants = new Map();

    this.sessionId = '';
    this.pin = '';
    this.userId = '';
    this.userName = '';

    this.commandsProcessor = null;

    var obj = this;  // for event handlers

    this.setCommandsProcessor = function(commands){
        this.commandsProcessor = commands;
    }

    /* Transactions */
    this.startTransaction = function (data, callback, errorCallback) {
        var transactionId = Janus.randomString(12);
        console.debug('chat: transaction start', transactionId, data, callback, errorCallback);

        data.transaction = transactionId;
        this.transactions[transactionId] = callback;
        console.debug('now we have', Object.keys(this.transactions).length, 'active transactions');

        this.textroom.data({
            text: JSON.stringify(data),
            error: function (reason) {
                console.error('chat: transaction send data error', reason);
                bootbox.alert(reason);
                if (errorCallback) {
                    errorCallback(reason);
                }
            }
        });

        return transactionId;
    };

    this.processTransactionAnswer = function (transactionId, data) {
        if (this.transactions[transactionId]) {
            console.debug('chat: transaction answered', transactionId, data)
            var ret = this.transactions[transactionId](data);
            delete this.transactions[transactionId];
            console.debug('chat: now we have', Object.keys(this.transactions).length, 'active transactions');
            return [undefined, null].indexOf(ret) < 0 ? ret : true;
        }
        return false;
    };


    /* Chat controls */
    this.disableAllChatControls = function () {
        this.sendButton.attr('disabled', true);
        this.messageInput.attr('disabled', true);
    };

    this.enableAllChatControls = function () {
        this.sendButton.removeAttr('disabled');
        this.messageInput.removeAttr('disabled');
        this.chatElem.css('height', '250px');
    };

    this.chatScrollDown = function () {
        this.chatElem.scrollTop(this.chatElem.prop('scrollHeight'));
    };


    /* HTML Event Handlers */
    this.chatForm.on("submit", function (e) {
        var data = obj.messageInput.val();
        obj.sendData(data)
        e.preventDefault();
    });


    /* TextRoom functions */
    this.setUp = function(textroom){
        this.textroom = textroom;
        console.info('chat: set up ..');

        var body = {"request": "setup"};
        this.textroom.send({"message": body});
    };

    this.startRoom = function (sessionId, pin) {
        this.sessionId = parseInt(sessionId, 10);
        this.pin = pin;

        this.userId = `admin:${sessionId}`;
        this.userName = `admin:${sessionId}`;

        this.registerUserAndJoinRoom();
    };

    this.leaveRoom = function(){
        this.disableAllChatControls();
        var leaveData = {
            textroom: "leave",
            room: this.sessionId,
        }
        console.debug('chat: leaving room', leaveData);
        this.startTransaction(leaveData, function(response){
            obj.textroom.hangup();
        });
    }

    this.registerUserAndJoinRoom = function () {
        this.disableAllChatControls();
        var registerData = {
            textroom: "join",
            room: this.sessionId,
            pin: this.pin,
            username: this.userId,
            display: this.userName,
        };
        console.debug('chat: join room & register user', registerData);

        this.startTransaction(registerData, function (response) {
            if (response.textroom === "error") {
                ui.connAbort();

                if (response.error_code === 417) {
                    ui.showError(`Session ${obj.sessionId} does not exist`, 'no_session')
                } else {
                    ui.showError(response.error, 'transaction_error');
                }
                return;
            }
            console.debug('chat: we are in the room!');

            var device = null;
            if(response.participants && response.participants.length > 0) {
                for (var i in response.participants) {
                    var p = response.participants[i];
                    var pId = p.username;
                    var pName = p.display ? p.display : p.username;
                    obj.participants.set(pId, pName);
                    if (pName !== obj.userId) {
                        obj.appendMessageToChat(`<i>${pName} already in room</i>`);
                    }

                    if (pId.substring(0, 7).toLowerCase() === 'device:'){
                        if(!device) {
                            device = [pId, pName];
                        } else {
                            console.warn('chat: it seems the room has more than one device!');
                        }
                    }
                }
                console.debug('chat: room has participants', Array.from(obj.participants.entries()));
            }
            // если явно не найден девайс при обработке присутствующих, при этом имеем единственного - делаем девайсом его
            if(!device && obj.participants.size === 1){
                device = obj.participants.entries().next().value;
            }
            if(device){
                ui.setDevice(device[0], device[1]);
            } else {
                console.error('chat: can not determine device from participants');
            }

            obj.enableAllChatControls();
            ui.connTextroomReady();

            ui.emit('RemoteChat.onManagementStart');
        }, function (reason) {
            ui.connAbort();
            obj.disableAllChatControls();
            console.error('chat: joining room error', reason);
            ui.showError(reason, 'join_error');
        });
    };

    this.sendData = function (data) {
        if (!data) {
            return;
        }

        var messageData = {
            textroom: "message",
            room: this.sessionId,
            text: data,
        };
        console.debug('textroom: sending chat message', messageData);

        this.disableAllChatControls();
        this.startTransaction(messageData, function (response) {
            obj.messageInput.val('');
            obj.enableAllChatControls();
        }, function (reason) {
            console.error('textroom: sending chat message error', reason);
            ui.showError(reason, 'textroom_send_error');
        });
    };

    this.cleanup = function () {
        console.debug('chat: cleanup');
        this.disableAllChatControls();
        ui.emit('RemoteChat.onManagementStop');
    };


    /* Messages Processing */
    this.processIncomingMessage = function (message, from, date, isWhisper){
        console.debug('chat: incoming message', message, from, date, isWhisper);
        if (this.commandsProcessor !== null){
            this.commandsProcessor.process(message);
        }
        message = this._formatMessageForHTML(message);
        var dateString = getDateString(date);
        if (isWhisper) {
            // Private message
            this.appendMessageToChat(`<b>[hidden message from ${from}]:</b> ${message}</p>`, 'gray', dateString);
        } else {
            // Public message
            this.appendMessageToChat(`<b>${from}:</b> ${message}</p>`, 'black', dateString);
        }

    };

    this.processAnnouncement = function (message, date){
        console.debug('chat: announcement', message, date);
        message = this._formatMessageForHTML(message);
        var dateString = getDateString(date);
        this.appendMessageToChat(`<i>${message}</i>`, 'purple', dateString);
    };

    this.processJoin = function (userId, userName){
        console.debug('chat: user joined', userId, userName);
        this.participants.set(userId, userName ? userName : userId);

        if (userId !== this.userId) {
            // todo: process somebody?
        }
        this.appendMessageToChat(`<i>${this.participants.get(userId)} joined</i>`, 'green');
    };

    this.processLeave = function (userId){
        console.debug('chat: user leaved', userId);
        this.appendMessageToChat(`<i>${this.participants.get(userId)} leaved</i>`, 'green');
        this.participants.delete(userId);

        if(userId === ui.deviceId){
            ui.sessionClosedRemotely('Device left the session');
        }
    };

    this.processKick = function (userId){
        console.debug('chat: user kicked', userId);
        this.appendMessageToChat(`<i>${this.participants.get(userId)} kicked</i>`, 'red');
        this.participants.delete(userId);

        if (userId === this.userId) {
            ui.sessionClosedRemotely('You has been kicked from session');
        }
    };

    this.processRoomDestroy = function (roomId){
        if (parseInt(roomId, 10) !== this.sessionId) {
            return;
        }
        console.debug('chat: current room has been destroyed', roomId);
        this.appendMessageToChat(`<b>Session ${this.sessionId} has been closed</b>`);

        ui.sessionClosedRemotely('Session has been closed');
    }

    this.appendMessageToChat = function (message, color, dateString){
        dateString = dateString ? dateString : getDateString();
        this.chatElem.append(`<p style="color: ${color};">[${dateString}] ${message}</p>`);
        this.chatScrollDown();
    }

    this._formatMessageForHTML = function (message){
        message = message.replace(new RegExp('<', 'g'), '&lt');
        message = message.replace(new RegExp('>', 'g'), '&gt');
        return message;
    }
}
