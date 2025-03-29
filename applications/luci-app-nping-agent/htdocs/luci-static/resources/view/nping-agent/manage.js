'use strict';
'require form';
'require view';
'require ui';
'require fs';
'require uci';
'require poll';
'require rpc';

// RPC call to get system information
const callSystemInfo = rpc.declare({
    object: 'system',
    method: 'info',
    expect: {}
});

// RPC call to get NPing service status
const callServiceStatus = rpc.declare({
    object: 'service',
    method: 'status',
    params: ['name'],
    expect: { '': {} }
});

// RPC call to execute commands (deprecated)
const callExec = rpc.declare({
    object: 'file',
    method: 'exec',
    params: ['command', 'params'],
    expect: { '': { code: -1, stdout: '', stderr: '' } }
});

// Check if file exists
function checkFileExists(path) {
    return fs.stat(path).then(function (stat) {
        return stat.type === 'file';
    }).catch(function () {
        return false;
    });
}

// Get architecture name
function getArchitecture() {
    console.log('Starting to get architecture information');

    // Use nping-agent-call script to get architecture information
    return callExec('/usr/libexec/nping-agent-call', ['arch']).then(function (res) {
        console.log('Architecture retrieval result:', res);

        if (res.code !== 0) {
            console.error('Architecture retrieval failed:', res.stderr);

            // Check for error code
            var errorMsg = 'Unknown error';
            if (res.stderr && res.stderr.indexOf('ERROR_CODE:') !== -1) {
                var errorCode = res.stderr.split('ERROR_CODE:')[1].trim();
                errorMsg = errorCode;
            }

            console.error('Architecture retrieval error:', errorMsg);
            return {
                raw: _('Unknown'),
                mapped: 'unknown'
            };
        }

        try {
            // Parse JSON response
            var archInfo = JSON.parse(res.stdout);
            console.log('Architecture information:', archInfo);
            return archInfo;
        } catch (e) {
            console.error('Error parsing architecture information:', e);
            return {
                raw: _('Unknown'),
                mapped: 'unknown'
            };
        }
    }).catch(function (error) {
        console.error('Error in architecture retrieval call:', error);
        return {
            raw: _('Unknown'),
            mapped: 'unknown'
        };
    });
}

// Download and install agent
function downloadAndInstallAgent(architecture) {
    console.log('Starting download, architecture info:', architecture);

    // Ensure architecture object format is correct
    if (!architecture || typeof architecture !== 'object' || !architecture.mapped) {
        console.error('Invalid architecture info', architecture);
        ui.addNotification(null, E('p', _('Unable to determine device architecture, please install manually')));
        return Promise.reject('Invalid architecture');
    }

    if (architecture.mapped === 'unknown') {
        ui.addNotification(null, E('p', _('Unable to determine device architecture, please install manually')));
        return Promise.reject('Unknown architecture');
    }

    var targetPath = '/tmp/nping-agent';

    // Show download progress modal
    ui.showModal(_('Downloading and Installing...'), [
        E('p', { 'class': 'spinning' }, _('Downloading and installing NPing node program, please wait...'))
    ]);

    // Use nping-agent-call script to download and install file
    return callExec('/usr/libexec/nping-agent-call', ['download', architecture.mapped, targetPath]).then(function (res) {
        console.log('Download installation result:', res);
        if (res.code !== 0 || res.stdout.indexOf('SUCCESS') === -1) {
            ui.hideModal();
            var errorMsg = _('Download or installation failed');

            // Check for error code
            if (res.stderr && res.stderr.indexOf('ERROR_CODE:') !== -1) {
                var errorCode = res.stderr.split('ERROR_CODE:')[1].trim();
                switch (errorCode) {
                    case 'PARAMETER_ERROR':
                        errorMsg = _('Parameter error: Invalid architecture or path');
                        break;
                    case 'DOWNLOAD_FAILED':
                        errorMsg = _('Download failed: Cannot retrieve node program');
                        break;
                    case 'PERMISSION_ERROR':
                        errorMsg = _('Permission error: Cannot set execution permission');
                        break;
                    case 'MOVE_FAILED':
                        errorMsg = _('Installation error: Cannot move file to system directory');
                        break;
                    default:
                        errorMsg = _('Download installation failed: ') + errorCode;
                }
            }

            ui.addNotification(null, E('p', errorMsg));
            return Promise.reject('Download failed');
        }

        // Installation completed, show success message
        ui.hideModal();
        ui.showModal(_('Installation Complete'), [
            E('p', {}, _('NPing node program has been successfully installed')),
            E('p', {}, _('The page will automatically refresh in 5 seconds...')),
            E('div', { 'class': 'right' }, [
                E('button', {
                    'class': 'btn cbi-button cbi-button-apply',
                    'click': function () {
                        ui.hideModal();
                        window.location.reload();
                    }
                }, _('Refresh Now'))
            ])
        ]);

        // Refresh page automatically in 5 seconds
        setTimeout(function () {
            window.location.reload();
        }, 5000);

        return true;
    }).catch(function (err) {
        console.error('Processing error:', err);
        ui.hideModal();
        ui.addNotification(null, E('p', _('Unable to download or install NPing node program')));
        return false;
    });
}

// Get version information
function getAgentVersion() {
    return checkFileExists('/usr/bin/nping-agent').then(function (exists) {
        if (exists) {
            return fs.exec('/usr/bin/nping-agent', ['-version']).then(function (res) {
                return {
                    exists: true,
                    version: res.stdout.trim() || _('Unknown')
                };
            }).catch(function () {
                return {
                    exists: true,
                    version: _('Get failed')
                };
            });
        } else {
            return {
                exists: false,
                version: _('File does not exist')
            };
        }
    });
}

return view.extend({
    // Disable footer buttons
    handleSave: null,
    handleSaveApply: null,
    handleReset: null,

    load: function () {
        return Promise.all([
            callSystemInfo(),
            // Do not use RPC call to check service status, but directly use init.d script
            fs.exec('/etc/init.d/nping-agent', ['status']).then(function (res) {
                return {
                    running: res.code === 0 && res.stdout.indexOf('running') > -1
                };
            }).catch(function (err) {
                console.error('Failed to get service status:', err);
                return { running: false };
            }),
            uci.load('nping-agent'),
            getAgentVersion(),
            getArchitecture()
        ]);
    },

    // Render file not exist page
    renderFileNotExist: function (architecture) {
        // Add debug output
        console.log('Rendering file not exist page, architecture info:', architecture);

        // Ensure architecture object format is correct
        if (!architecture || typeof architecture !== 'object') {
            architecture = { raw: _('Unknown'), mapped: 'unknown' };
        }

        // Check if button should be disabled
        var isDisabled = !architecture.mapped || architecture.mapped === 'unknown';
        console.log('Button disabled:', isDisabled, 'architecture mapped value:', architecture.mapped);

        // Build button attributes
        var btnAttrs = {
            'class': 'btn cbi-button cbi-button-apply',
            'click': function () {
                downloadAndInstallAgent(architecture);
            }
        };

        // Only add disabled attribute when needed
        if (isDisabled) {
            btnAttrs['disabled'] = true;
        }

        return E('div', { 'class': 'cbi-map' }, [
            E('h2', {}, _('NPing Node')),
            E('div', { 'class': 'cbi-map-descr' }, _('Configure NPing node service on this device')),
            E('div', { 'class': 'cbi-section' }, [
                E('div', { 'class': 'cbi-section-node' }, [
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('Status')),
                        E('div', { 'class': 'cbi-value-field' }, [
                            E('span', { 'style': 'color:#CC0000;font-weight:bold' }, _('NPing node program does not exist, please install first'))
                        ])
                    ]),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('Device Architecture')),
                        E('div', { 'class': 'cbi-value-field' }, [
                            architecture.raw === _('Unknown')
                                ? E('span', { 'style': 'color:#CC0000' }, architecture.raw)
                                : E('span', {}, architecture.raw + ' (' + architecture.mapped + ')')
                        ])
                    ]),
                    E('div', { 'class': 'cbi-value' }, [
                        E('label', { 'class': 'cbi-value-title' }, _('Operation')),
                        E('div', { 'class': 'cbi-value-field' }, [
                            E('button', btnAttrs, _('Install NPing node program'))
                        ])
                    ])
                ])
            ])
        ]);
    },

    // Render not registered page
    renderNotRegistered: function (agentVersion, systemInfo, serviceStatus, sectionName) {
        var m, s, o;

        m = new form.Map('nping-agent', _('NPing Node'), _('Configure NPing node service on this device'));
        m.submitFooter = false;

        s = m.section(form.TypedSection, 'nping-agent');
        s.anonymous = true;
        s.addremove = false;

        s.tab('general', _('General Settings'));

        // Add status hint
        o = s.taboption('general', form.DummyValue, '_status', _('Status'));
        o.cfgvalue = function () {
            return E('span', { 'style': 'color:#CC0000;font-weight:bold' }, _('NPing node program not registered, please complete registration'));
        };

        // Add kernel version display field
        o = s.taboption('general', form.DummyValue, '_kernel_version', _("Kernel Version"));
        o.cfgvalue = function () {
            return agentVersion.version;
        };

        // Add registration form - vendor key
        o = s.taboption('general', form.Value, 'vendor_key', _('Registration Key'));
        o.rmempty = false;
        o.placeholder = _('Please enter registration key');

        // Add registration form - node name
        o = s.taboption('general', form.Value, 'name', _('Node Name'));
        o.rmempty = false;
        o.placeholder = _('Please enter node name');

        // Add custom save button
        o = s.taboption('general', form.Button, '_save', ' ');
        o.inputstyle = 'apply';
        o.inputtitle = _('Register Device');
        o.onclick = function () {
            if (!sectionName) {
                ui.addNotification(null, E('p', _('Unable to determine configuration section name')));
                return false;
            }

            // Get vendor_key value
            var vendorKeyValue = this.map.lookupOption('vendor_key', sectionName)[0].formvalue(sectionName);
            console.log('Vendor Key:', vendorKeyValue);

            // Get name value
            var nameValue = this.map.lookupOption('name', sectionName)[0].formvalue(sectionName);
            console.log('Node Name:', nameValue);

            if (!vendorKeyValue || vendorKeyValue.trim() === '') {
                ui.addNotification(null, E('p', _('Please enter a valid registration key')));
                return false;
            }

            if (!nameValue || nameValue.trim() === '') {
                ui.addNotification(null, E('p', _('Please enter a valid node name')));
                return false;
            }

            // Show registration progress modal
            ui.showModal(_('Registering...'), [
                E('p', { 'class': 'spinning' }, _('Preparing to register, please wait...'))
            ]);

            // Use default country code CN
            var country = 'CN';

            // Show registration progress modal
            ui.showModal(_('Registering...'), [
                E('p', { 'class': 'spinning' }, _('Registering NPing node, please wait...'))
            ]);

            // Use nping-agent-call script to register node
            callExec('/usr/libexec/nping-agent-call', ['register', vendorKeyValue, nameValue, country]).then(function (regRes) {
                ui.hideModal();
                console.log('Registration request result:', regRes);

                if (regRes.code !== 0) {
                    var errorMsg = _('Registration request failed');

                    // Check for error code
                    if (regRes.stderr && regRes.stderr.indexOf('ERROR_CODE:') !== -1) {
                        var errorCode = regRes.stderr.split('ERROR_CODE:')[1].trim();
                        switch (errorCode) {
                            case 'PARAMETER_ERROR':
                                errorMsg = _('Parameter error: Please check registration key and node name');
                                break;
                            case 'REGISTRATION_FAILED':
                                errorMsg = _('Registration failed: Server refused request');
                                break;
                            case 'FILE_READ_ERROR':
                                errorMsg = _('Registration failed: Cannot read response data');
                                break;
                            default:
                                errorMsg = _('Registration failed: ') + errorCode;
                        }
                    }

                    console.error('Registration request failed:', regRes.stderr);
                    ui.addNotification(null, E('p', errorMsg));
                    return;
                }

                try {
                    var result = JSON.parse(regRes.stdout);
                    console.log('Registration response:', result);

                    if (result && result.data) {
                        var agentId = result.data;

                        uci.load('nping-agent')
                            .then(async () => {
                                var changes = await uci.changes();
                                if (Object.keys(changes).length > 0) {
                                    ui.addNotification(null, E('p', _('Some settings have not been saved or applied, please try again later')));
                                    return;
                                }

                                // Save all registration data
                                uci.set('nping-agent', sectionName, 'enabled', 1);
                                uci.set('nping-agent', sectionName, 'agent_id', agentId);
                                uci.save();

                                changes = await uci.changes();
                                if (Object.keys(changes).length == 0) {
                                    ui.addNotification(null, E('p', _('No settings modified')));
                                    return;
                                }

                                await uci.apply();
                                ui.addNotification(null, E('p', _('Device registered successfully')), 3000);

                                // Refresh page
                                setTimeout(function () {
                                    window.location.reload();
                                }, 1000);
                            });
                    } else {
                        var errorMsg = result && result.message ? result.message : 'Unknown error';
                        ui.addNotification(null, E('p', _('Registration failed: ') + errorMsg));
                    }
                } catch (e) {
                    console.error('Error parsing registration response JSON:', e, 'Original response:', regRes.stdout);
                    ui.addNotification(null, E('p', _('Registration response parsing failed')));
                }
            }).catch(function (err) {
                ui.hideModal();
                console.error('Registration request execution error:', err);
                ui.addNotification(null, E('p', _('Registration request execution failed')));
            });
        };

        return m.render();
    },

    // Render normal page
    renderNormal: function (agentVersion, systemInfo, serviceStatus, sectionName) {
        var m, s, o;

        m = new form.Map('nping-agent', _('NPing Node'), _('Configure NPing node service on this device'));
        m.submitFooter = false;

        s = m.section(form.TypedSection, 'nping-agent');
        s.anonymous = true;
        s.addremove = false;

        s.tab('general', _('General Settings'));

        o = s.taboption('general', form.Flag, 'enabled', _("Enable"));
        o.rmempty = false;
        o.default = o.disabled;

        // Add kernel version display field
        o = s.taboption('general', form.DummyValue, '_kernel_version', _("Kernel Version"));
        o.cfgvalue = function () {
            return agentVersion.version;
        };

        // Add registration status display field
        o = s.taboption('general', form.DummyValue, '_register_status', _("Registration Status"));
        o.cfgvalue = function () {
            return E('span', { 'style': 'color:#0000FF;font-weight:bold' }, _('Registered'));
        };

        // Add service status display field
        o = s.taboption('general', form.DummyValue, '_service_status', _("Service Status"));
        o.cfgvalue = function () {
            if (serviceStatus && serviceStatus.running) {
                return E('span', { 'style': 'color:#008000;font-weight:bold' }, _('Running'));
            } else {
                return E('span', { 'style': 'color:#FF0000;font-weight:bold' }, _('Not running'));
            }
        };

        // Add service control button
        o = s.taboption('general', form.Button, '_service_control', _('Service Operation'));
        o.inputstyle = serviceStatus && serviceStatus.running ? 'reset' : 'apply';
        o.inputtitle = serviceStatus && serviceStatus.running ? _('Stop Service') : _('Start Service');
        o.onclick = function () {
            // Print current button status for debugging
            console.log('Button clicked, current status:', this.inputtitle, this.inputstyle);

            // First check actual service status, then decide what to do
            ui.showModal(_('Checking service status...'), [
                E('p', { 'class': 'spinning' }, _('Please wait...'))
            ]);

            // Use init.d script to check service status
            callExec('/etc/init.d/nping-agent', ['status']).then(function (res) {
                console.log('Service status check result:', res);
                var isRunning = res.code === 0 && res.stdout.indexOf('running') > -1;
                var action = isRunning ? 'stop' : 'start';

                console.log('Status check parsing result:', isRunning, 'Executing action:', action);

                // Show progress hint
                ui.showModal(action === 'stop' ? _('Stopping service...') : _('Starting service...'), [
                    E('p', { 'class': 'spinning' }, _('Please wait...'))
                ]);

                if (action === 'stop') {
                    // Stop service directly call init.d script
                    callExec('/etc/init.d/nping-agent', [action]).then(function (res) {
                        console.log('Stop service result:', res);
                        ui.hideModal();

                        if (res.code !== 0) {
                            ui.addNotification(null, E('p', _('Service stop failed: ') + res.stderr));
                            return;
                        }

                        ui.addNotification(null, E('p', _('Service stopped')), 3000);

                        // Refresh page to update status
                        setTimeout(function () {
                            window.location.reload();
                        }, 1000);
                    }).catch(function (err) {
                        ui.hideModal();
                        console.error('Service stop error:', err);
                        ui.addNotification(null, E('p', _('Service stop execution failed')));
                    });
                } else {
                    // Start service needs to get agent_id
                    var agentId = uci.get('nping-agent', sectionName, 'agent_id') || '';
                    console.log('Using Agent ID:', agentId);

                    if (!agentId) {
                        ui.hideModal();
                        ui.addNotification(null, E('p', _('Missing Agent ID, cannot start service')));
                        return;
                    }

                    // Use nping-agent-call script to create configuration and start service
                    callExec('/usr/libexec/nping-agent-call', ['start', agentId]).then(function (res) {
                        console.log('Start service result:', res);
                        ui.hideModal();

                        if (res.code !== 0 || res.stdout.indexOf('SUCCESS') === -1) {
                            var errorMsg = _('Service start failed');

                            // Check for error code
                            if (res.stderr && res.stderr.indexOf('ERROR_CODE:') !== -1) {
                                var errorCode = res.stderr.split('ERROR_CODE:')[1].trim();
                                switch (errorCode) {
                                    case 'PARAMETER_ERROR':
                                        errorMsg = _('Parameter error: Invalid Agent ID');
                                        break;
                                    case 'CONFIG_WRITE_ERROR':
                                        errorMsg = _('Configuration write failed: Cannot create configuration file');
                                        break;
                                    case 'SERVICE_START_ERROR':
                                        errorMsg = _('Service start failed: Cannot start service');
                                        break;
                                    default:
                                        errorMsg = _('Service start failed: ') + errorCode;
                                }
                            }

                            ui.addNotification(null, E('p', errorMsg));
                            return;
                        }

                        ui.addNotification(null, E('p', _('Service started')), 3000);

                        // Refresh page to update status
                        console.log('Service started successfully, will refresh page');
                        setTimeout(function () {
                            window.location.reload();
                        }, 1000);
                    }).catch(function (err) {
                        ui.hideModal();
                        console.error('Service start error:', err);
                        ui.addNotification(null, E('p', _('Service start execution failed')));
                    });
                }
            }).catch(function (err) {
                ui.hideModal();
                console.error('Service status check error:', err);
                ui.addNotification(null, E('p', _('Service status check failed')));
            });

            return false;
        };

        // Add custom save button
        o = s.taboption('general', form.Button, '_save', ' ');
        o.inputstyle = 'apply';
        o.inputtitle = _('Save Settings');
        o.onclick = function () {
            if (!sectionName) {
                ui.addNotification(null, E('p', _('Unable to determine configuration section name')));
                return false;
            }

            // Get value of enabled from form
            var enabledValue = this.map.lookupOption('enabled', sectionName)[0].formvalue(sectionName);
            console.log('Enabled value:', enabledValue);

            uci.load('nping-agent')
                .then(async () => {
                    var changes = await uci.changes();
                    if (Object.keys(changes).length > 0) {
                        ui.addNotification(null, E('p', _('Some settings have not been saved or applied, please try again later')));
                        return;
                    }
                    uci.set('nping-agent', sectionName, 'enabled', enabledValue);
                    uci.save();
                    changes = await uci.changes();
                    if (Object.keys(changes).length == 0) {
                        ui.addNotification(null, E('p', _('No settings modified')));
                        return;
                    }
                    await uci.apply();
                    ui.addNotification(null, E('p', _('Settings saved and applied')), 3000);
                });
        };

        return m.render();
    },

    render: function (data) {
        var systemInfo = data[0];
        var serviceStatus = data[1];
        var uciData = data[2];
        var agentVersion = data[3];
        var architecture = data[4];

        // Debug: Check configuration structure
        console.log('UCI Data:', uciData);
        console.log('Agent Version:', agentVersion);
        console.log('Architecture:', architecture);
        console.log('Service Status from RPC:', serviceStatus);


        // Ensure architecture object structure is correct
        if (!architecture || typeof architecture !== 'object') {
            architecture = {
                raw: _('Unknown'),
                mapped: 'unknown'
            };
        } else if (!architecture.mapped) {
            // Compatible with previous case where it might return string instead of object
            architecture = {
                raw: architecture.toString(),
                mapped: architecture.toString() === 'unknown' ? 'unknown' : architecture.toString()
            };
        }

        // Find section name
        var sectionName = null;
        uci.sections('nping-agent', 'nping-agent').forEach(function (section) {
            sectionName = section['.name'];
            console.log('Section content:', section);
        });

        console.log('Section name:', sectionName);

        // Check if file exists
        if (!agentVersion || !agentVersion.exists) {
            return this.renderFileNotExist(architecture);
        }

        // Check if registered
        var agentId = '';
        if (sectionName) {
            agentId = uci.get('nping-agent', sectionName, 'agent_id') || '';
        }

        console.log('Agent ID:', agentId);

        // If agent_id is empty, show not registered page
        if (!agentId || agentId.trim() === '') {
            return this.renderNotRegistered(agentVersion, systemInfo, serviceStatus, sectionName);
        }

        // Otherwise show normal page
        return this.renderNormal(agentVersion, systemInfo, serviceStatus, sectionName);
    }
});