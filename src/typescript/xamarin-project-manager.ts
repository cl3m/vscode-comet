import { MSBuildProject, TargetFramework } from "./omnisharp/protocol";
import * as vscode from 'vscode';
import { BaseEvent, WorkspaceInformationUpdated } from './omnisharp/loggingEvents';
import { EventType } from './omnisharp/EventType';
import { MsBuildProjectAnalyzer } from './msbuild-project-analyzer';
import { DeviceData, XamarinUtil, SimCtlDevice, AppleDevicesAndSimulators } from "./xamarin-util";

let fs = require('fs');

export enum ProjectType
{
	Mono,
	Android,
	iOS,
	MacCatalyst,
	Mac,
	UWP,
	Unknown,
	WPF,
	Blazor,
}

export class MSBuildProjectInfo implements MSBuildProject {
	public static async fromProject(project: MSBuildProject): Promise<MSBuildProjectInfo> {
		var r = new MSBuildProjectInfo();

		r.ProjectGuid = project.ProjectGuid;
		r.Path = project.Path;
		r.AssemblyName = project.AssemblyName;
		r.TargetPath = project.TargetPath;
		r.TargetFramework = project.TargetFramework;
		r.SourceFiles = project.SourceFiles;
		r.TargetFrameworks = project.TargetFrameworks;
		r.OutputPath = project.OutputPath;
		r.IsExe = project.IsExe;
		r.IsUnityProject = project.IsUnityProject;

		var projXml = fs.readFileSync(r.Path);
		var msbpa = new MsBuildProjectAnalyzer(projXml);
		await msbpa.analyze();

		r.Configurations = msbpa.getConfigurationNames();
		r.Platforms = msbpa.getPlatformNames();
		r.Name = msbpa.getProjectName();
		return r;
	}

	Name: string;
	ProjectGuid: string;
	Path: string;
	AssemblyName: string;
	TargetPath: string;
	TargetFramework: string;
	SourceFiles: string[];
	TargetFrameworks: TargetFramework[];
	OutputPath: string;
	IsExe: boolean;
	IsUnityProject: boolean;

	Configurations: string[];
	Platforms: string[];
}

export class XamarinProjectManager {
	static SelectedProject: MSBuildProjectInfo;
	static SelectedProjectConfiguration: string;
	static SelectedTargetFramework: string;
	static SelectedDevice: DeviceData;
	static Devices: DeviceData[];
	static DebugPort: number = 55555;

	static Shared: XamarinProjectManager;

	omnisharp: any;
	context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		XamarinProjectManager.Shared = this;

		this.context = context;
		this.omnisharp = vscode.extensions.getExtension("ms-dotnettools.csharp").exports;

		this.loadingStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.loadingStatusBarItem.text = "Loading Mobile Projects...";
		this.loadingStatusBarItem.tooltip = "Loading Mobile Projects...";
		this.loadingStatusBarItem.show();

		this.omnisharp.eventStream.subscribe(async (e: BaseEvent) => {
			if (e.type === EventType.WorkspaceInformationUpdated) {

				this.StartupProjects = new Array<MSBuildProjectInfo>();

				for (var p of (<WorkspaceInformationUpdated>e).info.MsBuild.Projects) {
					
					if (XamarinProjectManager.getIsSupportedProject(p)) {
						this.StartupProjects.push(await MSBuildProjectInfo.fromProject(p));
					}
				}

				XamarinProjectManager.SelectedProject = undefined;
				XamarinProjectManager.SelectedProjectConfiguration = undefined;
				XamarinProjectManager.SelectedTargetFramework = undefined;
				XamarinProjectManager.SelectedDevice = undefined;

				// Try and auto select some defaults
				if (this.StartupProjects.length == 1)
				{
					var sp = this.StartupProjects[0];

					XamarinProjectManager.SelectedProject = sp;

					var defaultConfig = "Debug";

					if (!sp.Configurations || sp.Configurations.length <= 0)
					{
						XamarinProjectManager.SelectedProjectConfiguration = defaultConfig;
					}
					else
					{
						if (sp.Configurations.includes(defaultConfig))
							XamarinProjectManager.SelectedProjectConfiguration = defaultConfig;
						
						XamarinProjectManager.SelectedProjectConfiguration = sp.Configurations[0];
					}
						
					if (sp.TargetFrameworks)
					{
						XamarinProjectManager.SelectedTargetFramework = this.fixTfm(sp.TargetFrameworks[0].ShortName);
					}
					else
					{
						XamarinProjectManager.SelectedTargetFramework = this.fixTfm(sp.TargetFramework);
					}

					if (XamarinProjectManager.SelectedTargetFramework && XamarinProjectManager.getProjectType(XamarinProjectManager.SelectedTargetFramework) == ProjectType.MacCatalyst)
					{
						var deviceData = new DeviceData();
						deviceData.name = "Local Machine";
						deviceData.platform = 'maccatalyst';
						deviceData.serial = "local";

						XamarinProjectManager.SelectedDevice = deviceData;
					}
				}

				this.setupMenus();

				this.updateProjectStatus();
				this.updateDeviceStatus();
			}
		});
	}

	isMenuSetup: boolean = false;

	setupMenus()
	{
		if (this.isMenuSetup)
			return;

		this.loadingStatusBarItem.hide();
		this.loadingStatusBarItem.dispose();

		this.context.subscriptions.push(vscode.commands.registerCommand("xamarin.selectProject", this.showProjectPicker, this));
		this.context.subscriptions.push(vscode.commands.registerCommand("xamarin.selectDevice", this.showDevicePicker, this));

		this.projectStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.deviceStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		
		this.updateProjectStatus();
		this.updateDeviceStatus();
		
		this.isMenuSetup = true;
	}

	loadingStatusBarItem: vscode.StatusBarItem;
	projectStatusBarItem: vscode.StatusBarItem;
	deviceStatusBarItem: vscode.StatusBarItem;

	public StartupProjects = new Array<MSBuildProjectInfo>();

	fixTfm(targetFramework: string) : string {

		// /^net[0-9]{2}(\-[a-z0-9\.]+)?$/gis
		var r = /^net[0-9]{2}(\-[a-z0-9\.]+)?$/gis.test(targetFramework);
		if (r)
			return 'net' + targetFramework[3] + '.' + targetFramework[4] + targetFramework.substr(5);
		return targetFramework;
	}

	public async showProjectPicker(): Promise<void> {
		var projects = this.StartupProjects
			.map(x => ({
				//description: x.type.toString(),
				label: x.AssemblyName,
				project: x,
			}));
		const p = await vscode.window.showQuickPick(projects, { placeHolder: "Select a Startup Project" });
		if (p) {

			if (p.project.TargetFrameworks && p.project.TargetFrameworks.length > 0) {
				// Multi targeted app, ask the user which TFM to startup
				var tfms = p.project.TargetFrameworks
					// Only return supported tfms
					.filter(x => XamarinProjectManager.getIsSupportedTargetFramework(x.ShortName))
					.map(x => ({
						label: x.ShortName,
						tfm: x
					}));

				if (tfms && tfms.length == 1)
				{
					XamarinProjectManager.SelectedTargetFramework = this.fixTfm(tfms[0].tfm.ShortName);
				}
				else
				{
					const tfm = await vscode.window.showQuickPick(tfms, { placeHolder: "Target Framework" });
					if (tfm)
						XamarinProjectManager.SelectedTargetFramework = this.fixTfm(tfm.tfm.ShortName);
					else
						XamarinProjectManager.SelectedTargetFramework = this.fixTfm(p.project.TargetFramework);
				}
			}
			else {
				// Not multi targeted, don't need to ask the user
				XamarinProjectManager.SelectedTargetFramework = this.fixTfm(p.project.TargetFramework);
			}

			var config = "Debug";

			// If we have configurations ...
			if (p.project.Configurations && p.project.Configurations.length > 0)
			{
				// If we have only one config, use that, otherwise if > 1 and don't also have Debug, use the first
				if (p.project.Configurations.length == 1 || !p.project.Configurations.includes(config))
					config = p.project.Configurations[0];
			}

			XamarinProjectManager.SelectedProject = p.project;
			XamarinProjectManager.SelectedProjectConfiguration = config;
			XamarinProjectManager.SelectedDevice = undefined;
		}
		
		this.updateProjectStatus();
		this.updateDeviceStatus();
	}

	public async updateProjectStatus() {
		var selProj = XamarinProjectManager.SelectedProject;

		var projectString = selProj === undefined ? "Startup Project" : `${selProj.Name ?? selProj.AssemblyName} | ${XamarinProjectManager.SelectedTargetFramework} | ${XamarinProjectManager.SelectedProjectConfiguration}`;
		this.projectStatusBarItem.text = "$(project) " + projectString;
		this.projectStatusBarItem.tooltip = selProj === undefined ? "Select a Startup Project" : selProj.Path;
		this.projectStatusBarItem.command = "xamarin.selectProject";
		this.projectStatusBarItem.show();
	}


	public async showDevicePicker(): Promise<void> {

		if (XamarinProjectManager.SelectedProject === undefined) {
			await vscode.window.showInformationMessage("Select a Startup Project first.");
			return;
		}

		var tfm = XamarinProjectManager.SelectedTargetFramework;

		if (!tfm) {
			XamarinProjectManager.Devices = [];
		}
		else {
			var util = new XamarinUtil();

			var platform = XamarinProjectManager.getProjectType(tfm);

			if (platform === ProjectType.Android) {

				var androidDevices : DeviceData[] = [];

				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					cancellable: false,
					title: 'Loading Android Devices'
				}, async (progress) => {
					
					progress.report({  increment: 0 });
					androidDevices = await util.GetAndroidDevices();
					progress.report({ increment: 100 });
				});

				var androidPickerDevices = androidDevices
					.map(x => ({
						//description: x.type.toString(),
						label: x.name,
						device: x,
					}));

				if (androidPickerDevices && androidPickerDevices.length > 0)
				{
					// If only one, don't prompt to pick
					if (androidPickerDevices.length == 1)
					{
						XamarinProjectManager.SelectedDevice = androidPickerDevices[0].device;
					}
					else
					{
						const p = await vscode.window.showQuickPick(androidPickerDevices, { placeHolder: "Select a Device" });
						if (p) {
							XamarinProjectManager.SelectedDevice = p.device;
						}
					}
				}
			}
			else if (platform === ProjectType.MacCatalyst)
			{
				var deviceData = new DeviceData();
				deviceData.name = "Local Machine";
				deviceData.platform = 'maccatalyst';
				deviceData.serial = "local";

				XamarinProjectManager.SelectedDevice = deviceData;
			}
			else if (platform === ProjectType.iOS) {
				
				var iosDevices : AppleDevicesAndSimulators;

				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					cancellable: false,
					title: 'Loading iOS Devices'
				}, async (progress) => {
					
					progress.report({  increment: 0 });
					iosDevices = await util.GetiOSDevices();
					progress.report({ increment: 100 });
				});

				var iosPickerDevices = iosDevices.devices
					.map(x => ({
						//description: x.type.toString(),
						label: x.name,
						device: x,
						devices: null as SimCtlDevice[]
					}))
					.concat(iosDevices.simulators
						.map(y => ({
							label: y.name,
							device: null,
							devices: y.devices
						})));

				const p = await vscode.window.showQuickPick(iosPickerDevices, { placeHolder: "Select a Device" });
				if (p) {
					if (p.device)
						XamarinProjectManager.SelectedDevice = p.device;
					else {
						var devicePickerItems = p.devices
							.map(z => ({
								label: z.runtime.name,
								device: z
							}));

						var d;

						if (devicePickerItems && devicePickerItems.length > 0)
						{
							if (devicePickerItems.length == 1)
							{
								d = devicePickerItems[0];
							}
							else
							{
								d = await vscode.window.showQuickPick(devicePickerItems, { placeHolder: "Select a Runtime Version" });
							}
						}
						
						if (d) {
							var deviceData = new DeviceData();
							deviceData.name = d.device.name + ' | ' + d.device.runtime.name;
							deviceData.iosSimulatorDevice = d.device;
							deviceData.isEmulator = true;
							deviceData.isRunning = false;
							deviceData.platform = 'ios';
							deviceData.serial = d.device.udid;
							deviceData.version = d.device.runtime.version;

							XamarinProjectManager.SelectedDevice = deviceData;
						}
					}
				}
			}
		}

		this.updateDeviceStatus();
	}

	public async updateDeviceStatus() {
		var deviceStr = XamarinProjectManager.SelectedDevice === undefined ? "Select a Device" : `${XamarinProjectManager.SelectedDevice.name}`;
		this.deviceStatusBarItem.text = "$(device-mobile) " + deviceStr;
		this.deviceStatusBarItem.tooltip = XamarinProjectManager.SelectedProject === undefined ? "Select a Device" : deviceStr;
		this.deviceStatusBarItem.command = "xamarin.selectDevice";
		this.deviceStatusBarItem.show();
	}

	public static getIsSupportedTargetFramework(targetFramework: string) : boolean
	{
		var projType = this.getProjectType(targetFramework);

		return projType == ProjectType.Android || projType == ProjectType.iOS || projType == ProjectType.MacCatalyst;
	}

	public static getIsSupportedProject(project: MSBuildProject): boolean
	{
		if (project.TargetFrameworks && project.TargetFrameworks.length > 0) {

			for (var tf of project.TargetFrameworks)
			{
				if (this.getIsSupportedTargetFramework(tf.ShortName))
					return true;
			}
		} else {
			if (this.getIsSupportedTargetFramework(project.TargetFramework))
				return true;
		}

		return false;
	}

	public static getProjectType(targetFramework: string): ProjectType
	{
		if (!targetFramework)
			targetFramework = XamarinProjectManager.SelectedTargetFramework;

		if (!targetFramework)
			return ProjectType.Mono;
		
		var tfm = targetFramework.toLowerCase().replace(".", "");

		if (tfm.indexOf('monoandroid') >= 0 || tfm.indexOf('-android') >= 0)
			return ProjectType.Android;
		else if (tfm.indexOf('xamarinios') >= 0 || tfm.indexOf('-ios') >= 0)
			return ProjectType.iOS;
		else if (tfm.indexOf('xamarinmac') >= 0 || tfm.indexOf('-macos') >= 0)
			return ProjectType.Mac;
		else if (tfm.indexOf('xamarinmaccatalyst') >= 0 || tfm.indexOf('-maccatalyst') >= 0)
			return ProjectType.MacCatalyst;
	}

	public static getProjectIsCore(targetFramework: string): boolean
	{
		var tfm = targetFramework.toLowerCase();

		return tfm.startsWith('net') && this.getIsSupportedTargetFramework(tfm);
	}

	public static getSelectedProjectPlatform():string
	{
		var projectType = this.getProjectType(XamarinProjectManager.SelectedTargetFramework);

		if (projectType)
		{
			if (projectType === ProjectType.iOS)
			{
				if (XamarinProjectManager.SelectedDevice)
				{
					if (XamarinProjectManager.SelectedDevice.iosSimulatorDevice)
						return 'iPhoneSimulator';
				}

				return 'iPhone';
			}
		}
		
		return null;
	}
}