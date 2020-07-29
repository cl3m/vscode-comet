import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { XamarinProjectManager, ProjectType } from './xamarin-project-manager';

export class XamarinConfiguration implements DebugConfiguration {
	[key: string]: any;
	type: string;
	name: string;
	request: string;

}

export class XamarinConfigurationProvider implements vscode.DebugConfigurationProvider {

	constructor() {
	}

	async resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: vscode.CancellationToken): Promise<DebugConfiguration> {

		// No launch.json exists, let's help fill out a nice default
		if (!config.type && !config.request && !config.name)
		{
			config.type = 'xamarin';
			config.request = 'launch';
			return config;
		}

		// if launch.json is missing or empty
		if (config.type == 'xamarin') {
			// config.request = 'attach';

			var project = XamarinProjectManager.SelectedProject;

			if (!project)
				await XamarinProjectManager.Shared.showProjectPicker();

			if (!project) {
				vscode.window.showErrorMessage("Startup Project not selected!");
				return undefined;
			}

			if (project) {

				if (!config['projectPath'])
					config['projectPath'] = project.Path;

				if (!config['projectOutputPath'])
					config['projectOutputPath'] = project.OutputPath;

				if (!config['projectConfiguration'])
					config['projectConfiguration'] = XamarinProjectManager.SelectedProjectConfiguration;

				var projectType = XamarinProjectManager.getProjectType(XamarinProjectManager.SelectedTargetFramework);

				config['projectType'] = projectType;

				config['projectPlatform'] = XamarinProjectManager.getSelectedProjectPlatform();

				var device = XamarinProjectManager.SelectedDevice;

				if (!device)
				{ 
					await XamarinProjectManager.Shared.showDevicePicker();
					device = XamarinProjectManager.SelectedDevice;
				}

				if (!device) {
					vscode.window.showErrorMessage("Device not selected!");
					return undefined;
				}

				if (device) {
					if (projectType === ProjectType.Android) {
						if (device.serial)
							config['adbDeviceId'] = device.serial;
						else if (device.isEmulator)
							config['adbEmulatorName'] = device.name;

					} else if (projectType === ProjectType.iOS) {
						
						if (device.iosSimulatorDevice)
						{
							config['projectPlatform'] = 'iPhoneSimulator';
							config['iosSimulatorDeviceType'] = device.iosSimulatorDevice.deviceTypeIdentifier;
							config['iosSimulatorRuntime'] = device.iosSimulatorDevice.runtime.identifier;
							config['iosSimulatorVersion'] = device.iosSimulatorDevice.runtime.version;
						}
						else
						{
							config['projectPlatform'] = 'iPhone';
							config['iosDeviceId'] = device.serial;
						}
					}

					if (!config['device']) {
						if (device.serial)
							config['device'] = device.serial;
						else if (device.name)
							config['device'] = device.name;
					}

					config['devicePlatform'] = device.platform;
				}
			}
		}

		return config;
	}
}
